import type { PairingColor } from "./RelayApi";

export const SLOT_COUNT = 4;

/** Display names, keyed by PairingColor so a new color fails to compile until it has one. */
export const PAIRING_COLOR_NAMES = {
  red: "Röd",
  green: "Grön",
  yellow: "Gul",
  white: "Vit",
  pink: "Rosa",
} satisfies Record<PairingColor, string>;

/** The palette, in display order. */
export const PAIRING_PALETTE = Object.keys(
  PAIRING_COLOR_NAMES,
) as PairingColor[];

const KEY_COLORS = new Map<string, PairingColor>([
  ["1", "red"],
  ["2", "green"],
  ["3", "yellow"],
  ["4", "white"],
  ["5", "pink"],
]);

/** The palette color bound to a keyboard key, if any (case-insensitive). */
export function colorForKey(key: string): PairingColor | undefined {
  return KEY_COLORS.get(key.toLowerCase());
}

export type PickerState = {
  /** One entry per LED, left to right; null while empty. */
  slots: (PairingColor | null)[];
  /** Index of the slot that the next palette pick fills. */
  active: number;
};

export function emptyPicker(): PickerState {
  return { slots: Array.from({ length: SLOT_COUNT }, () => null), active: 0 };
}

/** The first empty slot after `from`, wrapping around; the last slot if all are filled. */
function nextActive(slots: (PairingColor | null)[], from: number): number {
  for (let i = from + 1; i < slots.length; i++) {
    if (slots[i] === null) return i;
  }
  const wrapped = slots.indexOf(null);
  return wrapped === -1 ? slots.length - 1 : wrapped;
}

/** Puts a color in the active slot, then moves the active slot to the next empty one. */
export function pickColor(
  state: PickerState,
  color: PairingColor,
): PickerState {
  const slots = state.slots.map((c, i) => (i === state.active ? color : c));
  return { slots, active: nextActive(slots, state.active) };
}

/** Makes a slot the active one, so it can be replaced without touching the others. */
export function selectSlot(state: PickerState, index: number): PickerState {
  return { ...state, active: index };
}

/** Empties the last filled slot and makes it active again. */
export function clearLast(state: PickerState): PickerState {
  let last = -1;
  state.slots.forEach((c, i) => {
    if (c !== null) last = i;
  });
  if (last === -1) return state;
  const slots = state.slots.map((c, i) => (i === last ? null : c));
  return { slots, active: last };
}

export function clearAll(): PickerState {
  return emptyPicker();
}

/** The full code, or null while any slot is still empty. */
export function completeCode(
  slots: (PairingColor | null)[],
): PairingColor[] | null {
  const code: PairingColor[] = [];
  for (const c of slots) {
    if (c === null) return null;
    code.push(c);
  }
  return code;
}

/** The chosen sequence as text, e.g. "Yellow, White, White, White". */
export function describeCode(slots: (PairingColor | null)[]): string {
  const code = completeCode(slots);
  if (!code) return `Välj ${SLOT_COUNT} färger`;
  return code.map((c) => PAIRING_COLOR_NAMES[c]).join(", ");
}
