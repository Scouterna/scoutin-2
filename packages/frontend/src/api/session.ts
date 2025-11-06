import { api, ws } from "./api";

export { ws } from "./api";

export async function create() {
  const res = await api.session.$post();
  return await res.json();
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
