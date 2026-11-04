import { describe, expect, it } from "vitest";
import { StepRegistry } from "./stepRegistry.ts";

describe("StepRegistry", () => {
  it("rejects a step that is both skipOnGoBack and preventGoBack", () => {
    expect(() =>
      new StepRegistry().register({
        id: "t:both",
        skipOnGoBack: true,
        preventGoBack: true,
      }),
    ).toThrow(/"t:both".*skipOnGoBack and preventGoBack/);
  });

  it("accepts either flag on its own", () => {
    const registry = new StepRegistry();
    registry.register({ id: "t:skip", skipOnGoBack: true });
    registry.register({ id: "t:barrier", preventGoBack: true });
    expect(registry.get("t:barrier")?.preventGoBack).toBe(true);
  });
});
