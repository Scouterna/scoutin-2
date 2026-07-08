import type { Listeners, MessageTypes } from "@scouterna/scoutin-backend";
import type { TypedSocket } from "@/api/typedSocket";

export const HEARTBEAT_INTERVAL_MS = 5_000;
export const HEARTBEAT_MAX_MISSED = 2;

/**
 * Detects silent disconnections (no `close` event ever fires) by sending a
 * `heartbeat` on an interval and expecting the server's echo back. If
 * HEARTBEAT_MAX_MISSED echoes in a row are missed, the connection is treated
 * as dead and `onDead` is called so the caller can force it closed.
 */
export function startHeartbeat(
  socket: TypedSocket<Listeners, MessageTypes>,
  onDead: () => void,
): () => void {
  let missed = 0;

  const onHeartbeat = () => {
    missed = 0;
  };
  socket.on("heartbeat", onHeartbeat);

  const timer = setInterval(() => {
    if (socket.readyState !== WebSocket.OPEN) return;

    if (missed >= HEARTBEAT_MAX_MISSED) {
      stop();
      onDead();
      return;
    }

    missed++;
    socket.send({ name: "heartbeat" });
  }, HEARTBEAT_INTERVAL_MS);

  const stop = () => {
    clearInterval(timer);
    socket.off("heartbeat", onHeartbeat);
  };

  return stop;
}
