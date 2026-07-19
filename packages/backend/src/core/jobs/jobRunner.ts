import { logger } from "../logging/logger.ts";

// Stable job identifiers shared between registration (index.ts) and manual
// triggers (the reimport route), so the two never drift apart.
export const DATA_IMPORT_JOB = "data-import";
export const CHECKIN_WRITEBACK_JOB = "checkin-writeback";

export type JobHandler = () => Promise<void>;

export interface JobDefinition {
  name: string;
  /** How often to run, in ms. `<= 0` means "never scheduled" (manual-only). */
  intervalMs: number;
  handler: JobHandler;
}

export interface RunOptions {
  /**
   * When true, guarantee a run that starts *after* this call so the caller
   * observes data produced after their request (used by manual reimport). If a
   * run is already in flight, a single fresh follow-up run is queued to start
   * when it finishes, rather than coalescing onto the (possibly stale) run.
   */
  fresh?: boolean;
}

export interface StopOptions {
  /** Max time to wait for in-flight runs before giving up and returning. */
  deadlineMs: number;
}

/**
 * A tiny in-process scheduler for the app's recurring jobs (data import,
 * check-in write-back). It exists to centralize three cross-cutting concerns
 * that are fragile when spread across ad-hoc `setInterval` closures:
 *
 *  - self-overlap guarding: a job never runs concurrently with itself, and a
 *    scheduled tick landing on an in-flight run is a no-op (see `runNow`);
 *  - error isolation: a failing run is logged and never kills the schedule;
 *  - graceful shutdown: `stop` stops scheduling and drains in-flight runs.
 *
 * Deliberately dependency-free and single-process (no Redis/cron/advisory
 * locks) — it must work identically under k8s, an app service, or a plain
 * process. Mirrors the class-registry idiom of `core/workflow/stepRegistry.ts`.
 */
export class JobRunner {
  private jobs = new Map<string, JobDefinition>();
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private inFlight = new Map<string, Promise<void>>();
  private queued = new Map<string, Promise<void>>();
  private shuttingDown = false;

  register(job: JobDefinition) {
    if (this.jobs.has(job.name)) {
      throw new Error(`Job with name "${job.name}" is already registered.`);
    }
    this.jobs.set(job.name, job);
  }

  /**
   * Runs a job, respecting the single-in-flight invariant.
   *
   * - Nothing in flight: starts a run and returns it.
   * - In flight, `fresh` not set (scheduled ticks, and the manual default):
   *   coalesces onto the in-flight run.
   * - In flight, `fresh` set (manual reimport): returns a single queued
   *   follow-up that starts once the current run finishes, so the caller is
   *   guaranteed a fetch newer than their request. Repeated fresh calls share
   *   the one queued follow-up.
   *
   * The returned promise rejects if the run throws so callers (e.g. the
   * reimport endpoint) see failures; the scheduler attaches its own catch so a
   * failed run never kills the loop.
   */
  runNow(name: string, options: RunOptions = {}): Promise<void> {
    // Don't start new work once shutdown has begun — such a run would be
    // untracked by stop() and killed mid-flight by process.exit. Return any
    // in-flight run so the caller can still await real work in progress.
    if (this.shuttingDown) {
      const existing = this.inFlight.get(name);
      if (existing) return existing;
      return Promise.reject(new Error("JobRunner is shutting down"));
    }

    const inFlight = this.inFlight.get(name);
    if (!inFlight) {
      return this.startRun(name);
    }

    if (!options.fresh) {
      return inFlight;
    }

    const queued = this.queued.get(name);
    if (queued) return queued;

    const followUp = inFlight
      // A failed current run must not cancel the queued fresh run.
      .catch(() => {})
      .then(() => {
        this.queued.delete(name);
        if (this.shuttingDown) return;
        return this.startRun(name);
      });
    this.queued.set(name, followUp);
    return followUp;
  }

  /**
   * Starts a run and records it as in-flight. The handler is invoked on a
   * microtask (via `Promise.resolve().then`) so `inFlight.set` below always
   * runs before the `finally` that clears it — otherwise a handler that threw
   * synchronously would delete the entry before it was set and permanently
   * poison the map for that job.
   */
  private startRun(name: string): Promise<void> {
    const job = this.jobs.get(name);
    if (!job) {
      return Promise.reject(
        new Error(`Job with name "${name}" is not registered.`),
      );
    }

    const run = Promise.resolve().then(async () => {
      const start = performance.now();
      logger.info({ job: name }, "Job started");
      try {
        await job.handler();
        logger.info(
          {
            job: name,
            durationSeconds: Number(
              ((performance.now() - start) / 1000).toFixed(2),
            ),
          },
          "Job finished",
        );
      } finally {
        this.inFlight.delete(name);
      }
    });

    this.inFlight.set(name, run);
    return run;
  }

  /**
   * Schedules every registered job whose `intervalMs > 0`. Ticks that fire
   * while a run is in flight (or during shutdown) are no-ops — reentrancy is
   * handled entirely by `runNow`'s in-flight guard.
   */
  start() {
    for (const job of this.jobs.values()) {
      if (job.intervalMs <= 0) {
        logger.info(
          { job: job.name },
          "Job disabled (intervalMs <= 0), manual-only",
        );
        continue;
      }

      const timer = setInterval(() => {
        if (this.shuttingDown) return;
        this.runNow(job.name).catch((err) => {
          logger.error({ err, job: job.name }, "Scheduled job run failed");
        });
      }, job.intervalMs);

      this.timers.set(job.name, timer);
      logger.info(
        { job: job.name, intervalMs: job.intervalMs },
        "Job scheduled",
      );
    }
  }

  /**
   * Stops scheduling and waits for in-flight runs to finish, up to
   * `deadlineMs`. Exceeding the deadline and returning anyway is safe because
   * the jobs are idempotent — the next run heals any partial progress. Queued
   * fresh follow-ups self-cancel via the `shuttingDown` check in `runNow`.
   */
  async stop({ deadlineMs }: StopOptions): Promise<void> {
    this.shuttingDown = true;
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();

    const pending = [...this.inFlight.values()];
    if (pending.length === 0) return;

    logger.info(
      { jobs: pending.length, deadlineMs },
      "Draining in-flight jobs before shutdown",
    );

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      timeoutHandle = setTimeout(resolve, deadlineMs);
    });

    await Promise.race([
      Promise.allSettled(pending).then(() => undefined),
      deadline,
    ]);

    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

// Config-free singleton (instantiation touches no config), imported by both the
// bootstrap (index.ts, which registers jobs + starts it) and the reimport route.
export const jobRunner = new JobRunner();
