type TapCounterOptions = {
  /** Taps needed to open. */
  taps?: number;
  /** The taps must all land within this many milliseconds of each other. */
  windowMs?: number;
  now?: () => number;
};

export type TapCounter = {
  /** Records a tap. Returns true when this tap completes the sequence. */
  tap(): boolean;
};

/**
 * Counts quick taps. Returns true on the tap that completes the required
 * count within the window, then starts over. Taps older than the window are
 * dropped, so slow taps never add up.
 */
export function createTapCounter({
  taps = 10,
  windowMs = 3000,
  now = Date.now,
}: TapCounterOptions = {}): TapCounter {
  let stamps: number[] = [];

  return {
    tap() {
      const current = now();
      stamps = stamps.filter((stamp) => current - stamp <= windowMs);
      stamps.push(current);

      if (stamps.length >= taps) {
        stamps = [];
        return true;
      }
      return false;
    },
  };
}
