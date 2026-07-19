import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../logging/logger.ts", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { JobRunner } from "./jobRunner.ts";

/** A promise plus its resolver, so a test controls when a handler finishes. */
function deferred() {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("JobRunner", () => {
  it("throws when registering a duplicate job name", () => {
    const runner = new JobRunner();
    const job = { name: "dup", intervalMs: 0, handler: async () => {} };
    runner.register(job);
    expect(() => runner.register(job)).toThrow(/already registered/);
  });

  it("rejects runNow for an unregistered job", async () => {
    const runner = new JobRunner();
    await expect(runner.runNow("nope")).rejects.toThrow(/not registered/);
  });

  it("coalesces concurrent runNow calls onto a single in-flight run", async () => {
    const runner = new JobRunner();
    const gate = deferred();
    const handler = vi.fn(() => gate.promise);
    runner.register({ name: "j", intervalMs: 0, handler });

    const p1 = runner.runNow("j");
    const p2 = runner.runNow("j");

    // Same run coalesced (handler is invoked on a microtask, so flush one).
    expect(p1).toBe(p2);
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);

    gate.resolve();
    await Promise.all([p1, p2]);

    // Once finished, a fresh call starts a new run.
    await runner.runNow("j");
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("queues a single fresh follow-up run when one is in flight", async () => {
    const runner = new JobRunner();
    let gate = deferred();
    const handler = vi.fn(() => gate.promise);
    runner.register({ name: "j", intervalMs: 0, handler });

    const first = runner.runNow("j");
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);

    // Two fresh triggers while the first run is in flight share ONE follow-up.
    const followA = runner.runNow("j", { fresh: true });
    const followB = runner.runNow("j", { fresh: true });
    expect(followA).toBe(followB);
    expect(followA).not.toBe(first);

    // The follow-up hasn't started yet — it waits for the current run.
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);

    // Finish the first run and pre-resolve the follow-up's gate; awaiting the
    // follow-up then guarantees it ran a genuinely fresh, second invocation.
    const firstGate = gate;
    gate = deferred();
    gate.resolve();
    firstGate.resolve();
    await followA;
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("a fresh follow-up still runs even if the in-flight run fails", async () => {
    const runner = new JobRunner();
    let attempt = 0;
    const gate = deferred();
    const handler = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("first fails");
      await gate.promise;
    });
    runner.register({ name: "j", intervalMs: 0, handler });

    const first = runner.runNow("j");
    const follow = runner.runNow("j", { fresh: true });

    await expect(first).rejects.toThrow("first fails");

    // Pre-resolve the second run's gate; awaiting the follow-up proves it ran
    // despite the first run's failure.
    gate.resolve();
    await follow;
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("does not permanently poison a job when a handler throws synchronously", async () => {
    const runner = new JobRunner();
    let mode: "throw" | "ok" = "throw";
    // A non-async handler that throws synchronously on the first call.
    const handler = vi.fn((): Promise<void> => {
      if (mode === "throw") throw new Error("sync boom");
      return Promise.resolve();
    });
    runner.register({ name: "j", intervalMs: 0, handler });

    await expect(runner.runNow("j")).rejects.toThrow("sync boom");

    // The in-flight entry was cleared, so the job can run again (not poisoned).
    mode = "ok";
    await expect(runner.runNow("j")).resolves.toBeUndefined();
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("reports status and records last-run outcome via list()", async () => {
    const runner = new JobRunner();
    let outcome: "ok" | "fail" = "ok";
    const gate = deferred();
    const handler = vi.fn(async () => {
      if (outcome === "fail") throw new Error("kaboom");
      await gate.promise;
    });
    runner.register({ name: "j", intervalMs: 5000, handler });

    // The single registered job's status.
    const status = () => {
      const [job] = runner.list();
      if (!job) throw new Error("expected one job");
      return job;
    };

    // Idle, never run.
    expect(runner.list()).toHaveLength(1);
    expect(status()).toMatchObject({
      name: "j",
      intervalMs: 5000,
      running: false,
      queued: false,
      lastRun: null,
    });

    // Running.
    const run = runner.runNow("j");
    await Promise.resolve();
    expect(status().running).toBe(true);

    // Finished successfully -> lastRun records ok + a duration.
    gate.resolve();
    await run;
    expect(status().running).toBe(false);
    expect(status().lastRun).toMatchObject({ ok: true });
    expect(status().lastRun?.error).toBeUndefined();
    expect(typeof status().lastRun?.durationMs).toBe("number");

    // A failing run records ok:false with the error message.
    outcome = "fail";
    await expect(runner.runNow("j")).rejects.toThrow("kaboom");
    expect(status().lastRun).toMatchObject({ ok: false, error: "kaboom" });
  });

  it("rejects runNow once shutting down (no untracked run)", async () => {
    const runner = new JobRunner();
    const handler = vi.fn(async () => {});
    runner.register({ name: "j", intervalMs: 0, handler });

    await runner.stop({ deadlineMs: 1000 });

    await expect(runner.runNow("j")).rejects.toThrow(/shutting down/);
    await Promise.resolve();
    expect(handler).not.toHaveBeenCalled();
  });

  it("propagates a handler rejection to the caller", async () => {
    const runner = new JobRunner();
    const handler = vi.fn(async () => {
      throw new Error("boom");
    });
    runner.register({ name: "j", intervalMs: 0, handler });

    await expect(runner.runNow("j")).rejects.toThrow("boom");
    // The in-flight entry is cleared even on failure, so the next run proceeds.
    await expect(runner.runNow("j")).rejects.toThrow("boom");
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("skips scheduled ticks while a run is in flight, then resumes", async () => {
    vi.useFakeTimers();
    const runner = new JobRunner();
    let gate = deferred();
    const handler = vi.fn(() => gate.promise);
    runner.register({ name: "s", intervalMs: 1000, handler });
    runner.start();

    await vi.advanceTimersByTimeAsync(1000);
    expect(handler).toHaveBeenCalledTimes(1);

    // Tick fires again while the first run is still in flight -> no-op.
    await vi.advanceTimersByTimeAsync(1000);
    expect(handler).toHaveBeenCalledTimes(1);

    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    gate = deferred();

    // Next tick after completion runs again.
    await vi.advanceTimersByTimeAsync(1000);
    expect(handler).toHaveBeenCalledTimes(2);

    gate.resolve();
    await runner.stop({ deadlineMs: 1000 });
  });

  it("does not schedule a job with intervalMs <= 0", async () => {
    vi.useFakeTimers();
    const runner = new JobRunner();
    const handler = vi.fn(async () => {});
    runner.register({ name: "manual", intervalMs: 0, handler });
    runner.start();

    await vi.advanceTimersByTimeAsync(10000);
    expect(handler).not.toHaveBeenCalled();

    // But it can still be run manually.
    await runner.runNow("manual");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("stop() waits for an in-flight run to finish", async () => {
    const runner = new JobRunner();
    const gate = deferred();
    runner.register({ name: "d", intervalMs: 0, handler: () => gate.promise });

    const run = runner.runNow("d");
    let stopped = false;
    const stopping = runner.stop({ deadlineMs: 10000 }).then(() => {
      stopped = true;
    });

    await Promise.resolve();
    expect(stopped).toBe(false);

    gate.resolve();
    await run;
    await stopping;
    expect(stopped).toBe(true);
  });

  it("stop() returns after the deadline even if a run hangs", async () => {
    vi.useFakeTimers();
    const runner = new JobRunner();
    // A handler that never resolves.
    runner.register({
      name: "h",
      intervalMs: 0,
      handler: () => new Promise(() => {}),
    });
    runner.runNow("h");

    const stopping = runner.stop({ deadlineMs: 5000 });
    await vi.advanceTimersByTimeAsync(5000);
    await expect(stopping).resolves.toBeUndefined();
  });

  it("stop() prevents further scheduled ticks", async () => {
    vi.useFakeTimers();
    const runner = new JobRunner();
    const handler = vi.fn(async () => {});
    runner.register({ name: "s", intervalMs: 1000, handler });
    runner.start();

    await runner.stop({ deadlineMs: 1000 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(handler).not.toHaveBeenCalled();
  });
});
