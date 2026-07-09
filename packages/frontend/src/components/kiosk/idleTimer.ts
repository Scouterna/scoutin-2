// Uniform for v1 — no per-screen override yet. A shorter timeout on the
// final ("success"/last) screen was part of the original request but is
// deferred; see stormote6-followup.md.
export const IDLE_TIMEOUT_MS = 45_000;
export const IDLE_COUNTDOWN_MS = 10_000;
const COUNTDOWN_TICK_MS = 1_000;

export type IdleTimerCallbacks = {
  /** Idle timeout elapsed; the cancellable countdown is starting. */
  onCountdownStart: () => void;
  /** Fired once per tick while the countdown is running. */
  onCountdownTick: (msRemaining: number) => void;
  /** Countdown was cancelled by activity/reset before it reached zero. */
  onCountdownCancel: () => void;
  /** Countdown reached zero — the session should be aborted. */
  onAbort: () => void;
};

/**
 * Framework-agnostic inactivity timer: after `idleTimeoutMs` with no
 * `reset()` calls, starts a cancellable countdown; if that also elapses
 * with no `reset()`, fires `onAbort`. Mirrors the shape of `startHeartbeat`
 * (./heartbeat.ts) — a plain start/stop pair the caller wires up to
 * whatever "activity" and "abort" mean in its context.
 */
export function startIdleTimer(
  callbacks: IdleTimerCallbacks,
  idleTimeoutMs: number = IDLE_TIMEOUT_MS,
  countdownMs: number = IDLE_COUNTDOWN_MS,
): { reset: () => void; stop: () => void } {
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let countdownInterval: ReturnType<typeof setInterval> | null = null;
  let inCountdown = false;

  const clearTimers = () => {
    if (idleTimer !== null) clearTimeout(idleTimer);
    if (countdownInterval !== null) clearInterval(countdownInterval);
    idleTimer = null;
    countdownInterval = null;
  };

  const scheduleIdle = () => {
    idleTimer = setTimeout(startCountdown, idleTimeoutMs);
  };

  function startCountdown() {
    inCountdown = true;
    let msRemaining = countdownMs;
    callbacks.onCountdownStart();
    callbacks.onCountdownTick(msRemaining);

    countdownInterval = setInterval(() => {
      msRemaining -= COUNTDOWN_TICK_MS;
      if (msRemaining <= 0) {
        clearTimers();
        inCountdown = false;
        callbacks.onAbort();
        return;
      }
      callbacks.onCountdownTick(msRemaining);
    }, COUNTDOWN_TICK_MS);
  }

  const reset = () => {
    const wasInCountdown = inCountdown;
    clearTimers();
    inCountdown = false;
    if (wasInCountdown) callbacks.onCountdownCancel();
    scheduleIdle();
  };

  const stop = () => {
    clearTimers();
    inCountdown = false;
  };

  scheduleIdle();

  return { reset, stop };
}
