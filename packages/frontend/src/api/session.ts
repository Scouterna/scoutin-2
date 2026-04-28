import type { Listeners, MessageTypes } from "@scouterna/scoutin-backend";
import { createAppError } from "../lib/errors";
import { createTypedSocket, type TypedSocket } from "./typedSocket";
import { api, ws } from "./api";

export { ws } from "./api";

export async function create() {
  try {
    const key = localStorage.getItem("kioskKey") ?? "";
    const res = await api.session.$post(
      {},
      { headers: { Authorization: `Bearer ${key}` } },
    );

    if (!res.ok) {
      throw createAppError(
        "network",
        `Kunde inte skapa session: ${res.statusText}`,
        { status: res.status },
      );
    }

    return await res.json();
  } catch (error) {
    // Network errors (no response from server)
    if (error instanceof TypeError) {
      throw createAppError("network", "Kunde inte ansluta till servern", error);
    }

    // Re-throw AppErrors as-is
    throw error;
  }
}

/**
 * Opens a WebSocket connection authenticated for the given session using an
 * admin-generated token. Intended for use in the admin panel.
 *
 * The optional `setup` callback is called with the socket after it's created
 * but before authentication is sent, so handlers registered there will receive
 * messages that the server sends immediately after auth (e.g. step:showScreen).
 */
export async function openAdminSessionSocket(
  sessionId: string,
  setup?: (socket: TypedSocket<Listeners, MessageTypes>) => void,
): Promise<TypedSocket<Listeners, MessageTypes>> {
  const res = await api.admin.sessions[":id"].token.$post({
    param: { id: sessionId },
  });
  if (!res.ok) throw new Error("Failed to obtain admin session token");
  const { token } = await res.json();

  const rawWs = await openSessionSocket();
  const socket = createTypedSocket<Listeners, MessageTypes>(rawWs);

  setup?.(socket);

  return new Promise((resolve, reject) => {
    socket.once("auth:status", (data) => {
      if (data.status === "success") {
        resolve(socket);
      } else {
        rawWs.close();
        reject(new Error(`Admin auth failed: ${"reason" in data ? data.reason : "unknown"}`));
      }
    });
    socket.send({ name: "auth:authenticate", data: { token } });
  });
}

export function openSessionSocket(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    try {
      // Next up: Don't just create the WebSocket here. Create it when the session is
      // started and authenticate using token.
      const socket = ws.session.$ws();

      socket.addEventListener("message", (event) => {
        console.log("Message from server:", event.data);
      });

      socket.addEventListener("error", reject);

      socket.addEventListener("open", () => {
        console.log("WebSocket connection established");
        socket.removeEventListener("error", reject);
        resolve(socket);
      });

      socket.addEventListener("close", () => {
        console.log("WebSocket connection closed");
      });
    } catch (e) {
      reject(e);
    }
  });
}
