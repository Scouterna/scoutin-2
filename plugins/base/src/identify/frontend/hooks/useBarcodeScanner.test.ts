// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

// Run the hook's effect inline so no React renderer is needed.
const cleanups: (() => void)[] = [];

vi.mock("react", () => ({
  useRef: (current: unknown) => ({ current }),
  useEffect: (fn: () => (() => void) | undefined) => {
    const cleanup = fn();
    if (cleanup) cleanups.push(cleanup);
  },
}));

async function setup(env: { markers?: string; enter?: string }) {
  vi.resetModules();
  vi.stubEnv("VITE_SCANNER_MARKERS", env.markers ?? "");
  vi.stubEnv("VITE_SCANNER_ENTER", env.enter ?? "");
  const { useBarcodeScanner } = await import("./useBarcodeScanner");
  const onScan = vi.fn();
  // biome-ignore lint/correctness/useHookAtTopLevel: the mocked hook runs inline
  useBarcodeScanner(onScan);
  return { onScan };
}

function press(key: string, timeStamp: number) {
  const e = new KeyboardEvent("keydown", { key, cancelable: true });
  Object.defineProperty(e, "timeStamp", { value: timeStamp });
  document.dispatchEvent(e);
  return e;
}

function type(text: string, startAt: number, gap: number) {
  let t = startAt;
  for (const ch of text) {
    press(ch, t);
    t += gap;
  }
  return t;
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.unstubAllEnvs();
});

describe("useBarcodeScanner", () => {
  it("reads both ¤data¤ and type-then-Enter by default", async () => {
    const { onScan } = await setup({});
    type("¤3236298¤", 0, 5);
    expect(onScan).toHaveBeenLastCalledWith("3236298");

    const end = type("12345", 1000, 5);
    press("Enter", end);
    expect(onScan).toHaveBeenLastCalledWith("12345");
    expect(onScan).toHaveBeenCalledTimes(2);
  });

  it("ignores type-then-Enter when turned off", async () => {
    const { onScan } = await setup({ enter: "false" });
    const end = type("12345", 0, 5);
    expect(press("Enter", end).defaultPrevented).toBe(false);
    expect(onScan).not.toHaveBeenCalled();
  });

  it("reads a fast burst followed by Enter when enabled", async () => {
    const { onScan } = await setup({});
    const end = type("3236298", 0, 5);
    expect(press("Enter", end).defaultPrevented).toBe(true);
    expect(onScan).toHaveBeenCalledWith("3236298");
  });

  it("ignores human-speed typing", async () => {
    const { onScan } = await setup({});
    const end = type("3236298", 0, 200);
    press("Enter", end);
    expect(onScan).not.toHaveBeenCalled();
  });

  it("ignores a lone Enter and a too-short burst", async () => {
    const { onScan } = await setup({});
    expect(press("Enter", 0).defaultPrevented).toBe(false);
    const end = type("12", 1000, 5);
    press("Enter", end);
    expect(onScan).not.toHaveBeenCalled();
  });

  it("ignores type-then-Enter while a text field is focused, but not markers", async () => {
    const { onScan } = await setup({});
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();

    const end = type("3236298", 0, 5);
    expect(press("Enter", end).defaultPrevented).toBe(false);
    expect(onScan).not.toHaveBeenCalled();

    type("¤3236298¤", 1000, 5);
    expect(onScan).toHaveBeenCalledWith("3236298");
    input.remove();
  });

  it("can turn markers off", async () => {
    const { onScan } = await setup({ markers: "false" });
    type("¤3236298¤", 0, 5);
    expect(onScan).not.toHaveBeenCalled();
  });
});
