import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_MAX_MISSED,
  startHeartbeat,
} from "./heartbeat";

function createFakeSocket() {
  const listeners = new Map<string, Array<() => void>>();

  return {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    on: vi.fn((name: string, listener: () => void) => {
      const existing = listeners.get(name) ?? [];
      existing.push(listener);
      listeners.set(name, existing);
    }),
    off: vi.fn((name: string, listener: () => void) => {
      const existing = listeners.get(name) ?? [];
      listeners.set(
        name,
        existing.filter((l) => l !== listener),
      );
    }),
    emit(name: string) {
      for (const listener of listeners.get(name) ?? []) listener();
    },
    // biome-ignore lint/suspicious/noExplicitAny: minimal fake, cast at call sites
  } as any;
}

describe("startHeartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends a heartbeat on each interval while echoes keep arriving", () => {
    const socket = createFakeSocket();
    startHeartbeat(socket, vi.fn());

    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
      socket.emit("heartbeat");
    }

    expect(socket.send).toHaveBeenCalledTimes(3);
    expect(socket.send).toHaveBeenCalledWith({ name: "heartbeat" });
  });

  it("resets the missed count when a heartbeat echo is received", () => {
    const socket = createFakeSocket();
    const onDead = vi.fn();
    startHeartbeat(socket, onDead);

    for (let i = 0; i < HEARTBEAT_MAX_MISSED; i++) {
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
      socket.emit("heartbeat");
    }

    expect(onDead).not.toHaveBeenCalled();
  });

  it("calls onDead after missing HEARTBEAT_MAX_MISSED echoes in a row", () => {
    const socket = createFakeSocket();
    const onDead = vi.fn();
    startHeartbeat(socket, onDead);

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * (HEARTBEAT_MAX_MISSED + 1));

    expect(onDead).toHaveBeenCalledTimes(1);
  });

  it("stops sending heartbeats once stop() is called", () => {
    const socket = createFakeSocket();
    const stop = startHeartbeat(socket, vi.fn());

    stop();
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 5);

    expect(socket.send).not.toHaveBeenCalled();
    expect(socket.off).toHaveBeenCalledWith("heartbeat", expect.any(Function));
  });

  it("does not send while the socket is not open", () => {
    const socket = createFakeSocket();
    socket.readyState = WebSocket.CLOSED;
    startHeartbeat(socket, vi.fn());

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 3);

    expect(socket.send).not.toHaveBeenCalled();
  });
});
