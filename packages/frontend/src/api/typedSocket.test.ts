import { describe, expect, it, vi } from "vitest";
import { createTypedSocket } from "./typedSocket";

function createFakeRawSocket(readyState: number) {
  return {
    readyState,
    send: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    close: vi.fn(),
    dispatchEvent: vi.fn(),
    url: "ws://localhost",
    protocol: "",
    extensions: "",
    bufferedAmount: 0,
    binaryType: "blob",
    onopen: null,
    onclose: null,
    onmessage: null,
    onerror: null,
    // biome-ignore lint/suspicious/noExplicitAny: minimal fake, cast at call sites
  } as any;
}

type TestSend = { name: "test"; data: string };
type TestListen = { name: "test"; data: string };

describe("createTypedSocket send", () => {
  it("forwards to the raw socket and does not call onSendFailure when open", () => {
    const raw = createFakeRawSocket(WebSocket.OPEN);
    const onSendFailure = vi.fn();
    const socket = createTypedSocket<TestSend, TestListen>(raw, onSendFailure);

    socket.send({ name: "test", data: "hello" });

    expect(raw.send).toHaveBeenCalledWith(
      JSON.stringify({ name: "test", data: "hello" }),
    );
    expect(onSendFailure).not.toHaveBeenCalled();
  });

  it("calls onSendFailure and does not forward when the socket is not open", () => {
    const raw = createFakeRawSocket(WebSocket.CLOSED);
    const onSendFailure = vi.fn();
    const socket = createTypedSocket<TestSend, TestListen>(raw, onSendFailure);

    socket.send({ name: "test", data: "hello" });

    expect(raw.send).not.toHaveBeenCalled();
    expect(onSendFailure).toHaveBeenCalledWith(
      "WebSocket send attempted while not open",
    );
  });

  it("does not throw when onSendFailure is omitted and the socket is not open", () => {
    const raw = createFakeRawSocket(WebSocket.CONNECTING);
    const socket = createTypedSocket<TestSend, TestListen>(raw);

    expect(() => socket.send({ name: "test", data: "hello" })).not.toThrow();
    expect(raw.send).not.toHaveBeenCalled();
  });
});
