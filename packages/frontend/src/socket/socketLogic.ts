import type { Listeners, MessageTypes } from "@scouterna/scoutin-backend";
import type { TypedSocket } from "@/api/typedSocket";
import { currentScreenAtom, screenHistoryAtom } from "@/store/session";
import { store } from "@/store/store";

export function setupSocket(socket: TypedSocket<Listeners, MessageTypes>) {
  socket.on("stepStarted", () => {
    store.set(screenHistoryAtom, []);
  });

  socket.on("showScreen", ({ screenId, payload }) => {
    const current = store.get(currentScreenAtom);
    if (current) {
      store.set(screenHistoryAtom, (prev) => [...prev, current]);
    }

    store.set(currentScreenAtom, { screenId, payload });
  });
}
