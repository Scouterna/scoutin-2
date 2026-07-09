import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IDLE_COUNTDOWN_MS,
  IDLE_TIMEOUT_MS,
  startIdleTimer,
} from "./idleTimer";

function createCallbacks() {
  return {
    onCountdownStart: vi.fn(),
    onCountdownTick: vi.fn(),
    onCountdownCancel: vi.fn(),
    onAbort: vi.fn(),
  };
}

describe("startIdleTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts the countdown after the idle timeout with no activity", () => {
    const callbacks = createCallbacks();
    startIdleTimer(callbacks);

    vi.advanceTimersByTime(IDLE_TIMEOUT_MS);

    expect(callbacks.onCountdownStart).toHaveBeenCalledTimes(1);
    expect(callbacks.onCountdownTick).toHaveBeenCalledWith(IDLE_COUNTDOWN_MS);
  });

  it("does not start the countdown if reset() is called before the idle timeout", () => {
    const callbacks = createCallbacks();
    const { reset } = startIdleTimer(callbacks);

    vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1);
    reset();
    vi.advanceTimersByTime(1);

    expect(callbacks.onCountdownStart).not.toHaveBeenCalled();
  });

  it("ticks down once per second during the countdown", () => {
    const callbacks = createCallbacks();
    startIdleTimer(callbacks);

    vi.advanceTimersByTime(IDLE_TIMEOUT_MS);
    vi.advanceTimersByTime(1_000);
    vi.advanceTimersByTime(1_000);

    expect(callbacks.onCountdownTick).toHaveBeenCalledWith(
      IDLE_COUNTDOWN_MS - 1_000,
    );
    expect(callbacks.onCountdownTick).toHaveBeenCalledWith(
      IDLE_COUNTDOWN_MS - 2_000,
    );
  });

  it("calls onAbort once the countdown reaches zero with no reset", () => {
    const callbacks = createCallbacks();
    startIdleTimer(callbacks);

    vi.advanceTimersByTime(IDLE_TIMEOUT_MS + IDLE_COUNTDOWN_MS);

    expect(callbacks.onAbort).toHaveBeenCalledTimes(1);
  });

  it("cancels the countdown and calls onCountdownCancel when reset() is called mid-countdown", () => {
    const callbacks = createCallbacks();
    const { reset } = startIdleTimer(callbacks);

    vi.advanceTimersByTime(IDLE_TIMEOUT_MS);
    expect(callbacks.onCountdownStart).toHaveBeenCalledTimes(1);

    reset();

    expect(callbacks.onCountdownCancel).toHaveBeenCalledTimes(1);
    expect(callbacks.onAbort).not.toHaveBeenCalled();

    // A fresh idle wait should now be running instead of the countdown.
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1);
    expect(callbacks.onCountdownStart).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(callbacks.onCountdownStart).toHaveBeenCalledTimes(2);
  });

  it("does not call onCountdownCancel when reset() is called during the idle wait (not mid-countdown)", () => {
    const callbacks = createCallbacks();
    const { reset } = startIdleTimer(callbacks);

    reset();

    expect(callbacks.onCountdownCancel).not.toHaveBeenCalled();
  });

  it("stop() prevents any further callbacks from firing", () => {
    const callbacks = createCallbacks();
    const { stop } = startIdleTimer(callbacks);

    stop();
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS + IDLE_COUNTDOWN_MS);

    expect(callbacks.onCountdownStart).not.toHaveBeenCalled();
    expect(callbacks.onAbort).not.toHaveBeenCalled();
  });

  it("supports custom idle/countdown durations", () => {
    const callbacks = createCallbacks();
    startIdleTimer(callbacks, 5_000, 2_000);

    vi.advanceTimersByTime(5_000);
    expect(callbacks.onCountdownStart).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2_000);
    expect(callbacks.onAbort).toHaveBeenCalledTimes(1);
  });
});
