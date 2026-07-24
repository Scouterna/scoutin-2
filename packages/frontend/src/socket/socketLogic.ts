import type { Listeners, MessageTypes } from "@scouterna/scoutin-backend";
import {
  coerceLanguage,
  DEFAULT_LANGUAGE,
} from "@scouterna/scoutin-plugin-api/frontend";
import type { TypedSocket } from "@/api/typedSocket";
import { showErrorToast } from "@/lib/errors";
import {
  currentScreenAtom,
  languageAtom,
  pendingAutoRestartAtom,
  screenHistoryAtom,
  sessionInfoAtom,
} from "@/store/session";
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
    store.set(languageAtom, DEFAULT_LANGUAGE);
  });

  socket.on("session:completed", () => {
    store.set(currentScreenAtom, null);
    store.set(screenHistoryAtom, []);
    store.set(sessionInfoAtom, null);
    store.set(languageAtom, DEFAULT_LANGUAGE);
    store.set(pendingAutoRestartAtom, true);
  });

  socket.on("session:info", (data) => {
    store.set(sessionInfoAtom, { actor: data.actor ?? null });
    if (data.language !== undefined) {
      store.set(languageAtom, coerceLanguage(data.language));
    }
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
