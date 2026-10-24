import { describe, expect, it } from "vitest";
import {
  clearAll,
  clearLast,
  colorForKey,
  completeCode,
  describeCode,
  emptyPicker,
  pickColor,
  selectSlot,
} from "./PairingColors";

describe("pairing color picker", () => {
  it("fills slots in order and advances the active slot", () => {
    let state = emptyPicker();
    state = pickColor(state, "red");
    state = pickColor(state, "green");
    expect(state.slots).toEqual(["red", "green", null, null]);
    expect(state.active).toBe(2);
  });

  it("stays on the last slot once all are filled", () => {
    let state = emptyPicker();
    for (const c of ["red", "green", "yellow", "white"] as const) {
      state = pickColor(state, c);
    }
    expect(state.active).toBe(3);
    state = pickColor(state, "pink");
    expect(state.slots).toEqual(["red", "green", "yellow", "pink"]);
    expect(state.active).toBe(3);
  });

  it("replaces the active slot when it is filled", () => {
    let state = emptyPicker();
    state = pickColor(state, "red");
    state = pickColor(state, "red");
    state = selectSlot(state, 0);
    state = pickColor(state, "yellow");
    expect(state.slots).toEqual(["yellow", "red", null, null]);
    expect(state.active).toBe(2);
  });

  it("clears only the last filled slot on backspace", () => {
    let state = emptyPicker();
    state = pickColor(state, "red");
    state = pickColor(state, "white");
    state = clearLast(state);
    expect(state.slots).toEqual(["red", null, null, null]);
    expect(state.active).toBe(1);
  });

  it("does nothing on backspace when empty", () => {
    const state = emptyPicker();
    expect(clearLast(state)).toBe(state);
  });

  it("clears all slots", () => {
    let state = emptyPicker();
    state = pickColor(state, "red");
    state = pickColor(state, "green");
    expect(clearAll()).toEqual(emptyPicker());
    expect(state.slots.some((c) => c !== null)).toBe(true);
  });

  it("returns the code only when complete", () => {
    expect(completeCode([null, "red", "red", "red"])).toBeNull();
    expect(completeCode(["red", "green", "yellow", "white"])).toEqual([
      "red",
      "green",
      "yellow",
      "white",
    ]);
  });

  it("describes the sequence", () => {
    expect(describeCode(["yellow", "white", "white", null])).toBe(
      "Välj 4 färger",
    );
    expect(describeCode(["yellow", "white", "white", "white"])).toBe(
      "Gul, Vit, Vit, Vit",
    );
  });

  it("maps the keys 1 to 5 to the palette in order", () => {
    expect(colorForKey("1")).toBe("red");
    expect(colorForKey("2")).toBe("green");
    expect(colorForKey("3")).toBe("yellow");
    expect(colorForKey("4")).toBe("white");
    expect(colorForKey("5")).toBe("pink");
    expect(colorForKey("6")).toBeUndefined();
    expect(colorForKey("r")).toBeUndefined();
  });
});
