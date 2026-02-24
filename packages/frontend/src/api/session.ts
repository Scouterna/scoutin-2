import { toast } from "sonner";
import { createAppError } from "../lib/errors";
import { api, ws } from "./api";

export { ws } from "./api";

export async function create() {
  try {
    const res = await api.session.$post();

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
        toast.error("WebSocket connection closed", {
          duration: Infinity,
        });
      });
    } catch (e) {
      reject(e);
    }
  });
}
