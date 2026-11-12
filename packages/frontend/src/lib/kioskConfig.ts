// Kiosk texts, set per event. Build-time, like all VITE_ vars.

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is not defined`);
  }
  return value;
}

/** Event name in the greetings ("Välkommen till <name>!"). */
export const eventName = required(
  "VITE_EVENT_NAME",
  import.meta.env.VITE_EVENT_NAME,
);

/** Instruction under the greeting on the kiosk start screen. */
export const startText = required(
  "VITE_START_TEXT",
  import.meta.env.VITE_START_TEXT,
);
