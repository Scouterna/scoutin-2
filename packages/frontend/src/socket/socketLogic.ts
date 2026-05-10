import type { Listeners, MessageTypes } from "@scouterna/scoutin-backend";
import type { TypedSocket } from "@/api/typedSocket";
import { showErrorToast } from "@/lib/errors";
import { currentScreenAtom, screenHistoryAtom, sessionInfoAtom } from "@/store/session";
import { store } from "@/store/store";

export function setupSocket(socket: TypedSocket<Listeners, MessageTypes>) {
  // Set when step:started arrives; cleared on the first step:showScreen.
  // Prevents the entry screen of a new step from being pushed onto history.
  let stepJustStarted = false;

  socket.on("step:started", () => {
    store.set(screenHistoryAtom, []);
    stepJustStarted = true;
  });

  socket.on("session:terminated", () => {
    store.set(currentScreenAtom, null);
    store.set(screenHistoryAtom, []);
    store.set(sessionInfoAtom, null);
  });

  socket.on("session:info", (data) => {
    store.set(sessionInfoAtom, { actor: data.actor ?? null });
  });

  socket.on("error", ({ code, message }) => {
    showErrorToast({ message, details: code });
  });

  socket.on("step:showScreen", ({ screenId, payload }) => {
    const current = store.get(currentScreenAtom);
    if (current && !stepJustStarted) {
      store.set(screenHistoryAtom, (prev) => [...prev, current]);
    }
    stepJustStarted = false;

    store.set(currentScreenAtom, { screenId, payload });
  });
}
