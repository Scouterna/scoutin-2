import type { Listeners, MessageTypes } from "@scouterna/scoutin-backend";
import type { TypedSocket } from "@/api/typedSocket";
import { currentScreenAtom } from "@/store/session";
import { store } from "@/store/store";

export function setupSocket(socket: TypedSocket<Listeners, MessageTypes>) {
  socket.on("showScreen", ({ screenId, payload }) => {
    store.set(currentScreenAtom, { screenId, payload });
  });
}
