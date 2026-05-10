import type { Listeners, MessageTypes } from "@scouterna/scoutin-backend";
import type { TypedSocket } from "@/api/typedSocket";
import { showErrorToast } from "@/lib/errors";
import { currentScreenAtom, screenHistoryAtom, sessionInfoAtom } from "@/store/session";
import { store } from "@/store/store";

export function setupSocket(socket: TypedSocket<Listeners, MessageTypes>) {
  socket.on("step:started", () => {
    store.set(screenHistoryAtom, []);
  });

  socket.on("session:terminated", () => {
    store.set(currentScreenAtom, null);
    store.set(screenHistoryAtom, []);
    store.set(sessionInfoAtom, null);
  });

  socket.on("session:info", (data) => {
    store.set(sessionInfoAtom, data);
  });

  socket.on("error", ({ code, message }) => {
    showErrorToast({ message, details: code });
  });

  socket.on("step:showScreen", ({ screenId, payload }) => {
    const current = store.get(currentScreenAtom);
    if (current) {
      store.set(screenHistoryAtom, (prev) => [...prev, current]);
    }

    store.set(currentScreenAtom, { screenId, payload });
  });
}
