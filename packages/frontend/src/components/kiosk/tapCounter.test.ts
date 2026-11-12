import { describe, expect, it } from "vitest";
import { createTapCounter } from "./tapCounter";

function setup() {
  let time = 0;
  const counter = createTapCounter({
    taps: 10,
    windowMs: 3000,
    now: () => time,
  });
  return {
    counter,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe("createTapCounter", () => {
  it("opens on the 10th quick tap", () => {
    const { counter, advance } = setup();
    const results: boolean[] = [];
    for (let i = 0; i < 10; i++) {
      results.push(counter.tap());
      advance(100);
    }

    expect(results.slice(0, 9)).toEqual(Array(9).fill(false));
    expect(results[9]).toBe(true);
  });

  it("does not open after only 9 quick taps", () => {
    const { counter, advance } = setup();
    for (let i = 0; i < 9; i++) {
      expect(counter.tap()).toBe(false);
      advance(100);
    }
  });

  it("does not open when the taps are too slow", () => {
    const { counter, advance } = setup();
    for (let i = 0; i < 20; i++) {
      expect(counter.tap()).toBe(false);
      advance(1000);
    }
  });

  it("resets after opening, so 10 more taps are needed", () => {
    const { counter, advance } = setup();
    for (let i = 0; i < 10; i++) {
      counter.tap();
      advance(100);
    }

    for (let i = 0; i < 9; i++) {
      expect(counter.tap()).toBe(false);
      advance(100);
    }
    expect(counter.tap()).toBe(true);
  });
});
