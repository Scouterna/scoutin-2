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
 * Creates a session from a pre-checkin link and opens an unauthenticated
 * WebSocket connection. Call `authenticateSocket` with the returned token to
 * start the flow. Intended for use in the link flow.
 */
export async function prepareLinkSocket(linkId: string): Promise<{
  socket: TypedSocket<Listeners, MessageTypes>;
  token: string;
}> {
  const res = await api.session["from-link"].$post({ json: { linkId } });
  if (!res.ok) throw new Error("Failed to create session from link");
  const { token } = await res.json();

  const rawWs = await openSessionSocket();
  const socket = createTypedSocket<Listeners, MessageTypes>(rawWs);

  return { socket, token };
}

/**
 * Authenticates an existing WebSocket connection using a session token.
 */
export async function authenticateSocket(
  socket: TypedSocket<Listeners, MessageTypes>,
  token: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("auth:status", (data) => {
      if (data.status === "success") {
        resolve();
      } else {
        reject(
          new Error(
            `Auth failed: ${"reason" in data ? data.reason : "unknown"}`,
          ),
        );
      }
    });
    socket.send({ name: "auth:authenticate", data: { token } });
  });
}

/**
 * Opens an authenticated WebSocket connection for an existing session using an
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

/**
 * Opens a raw unauthenticated WebSocket connection. Authentication is handled
 * separately by sending an `auth:authenticate` message after connecting.
 */
export function openSessionSocket(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    try {
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
