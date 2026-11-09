import { describe, expect, it, vi } from "vitest";
import { script } from "./script.ts";

function makeCtx(inputs: Record<string, unknown>) {
  return {
    stepKey: "badges",
    getInputs: () => inputs,
    setCompleted: vi.fn(),
  };
}

async function start(ctx: ReturnType<typeof makeCtx>) {
  // biome-ignore lint/suspicious/noExplicitAny: minimal mock context
  await script.hooks?.onStepStart?.(ctx as any);
}

describe("base:script", () => {
  it("completes with the result as output", async () => {
    const ctx = makeCtx({
      variables: { n: 2 },
      script: "return { double: n * 2 };",
    });
    await start(ctx);
    expect(ctx.setCompleted).toHaveBeenCalledWith({ result: { double: 4 } });
  });

  it("declares result as an output, so core keeps it", async () => {
    const validated = await script.outputs?.["~standard"].validate({
      result: [{ firstName: "A" }],
    });
    expect(validated).toEqual({ value: { result: [{ firstName: "A" }] } });
  });

  it("does not label the next step's errors as script errors", async () => {
    const ctx = makeCtx({ script: "return 1;" });
    ctx.setCompleted.mockRejectedValue(new Error("next step failed"));
    await expect(start(ctx)).rejects.toThrow(/^next step failed$/);
  });

  it("wraps errors with the step key", async () => {
    const ctx = makeCtx({ script: "throw new Error('boom');" });
    await expect(start(ctx)).rejects.toThrow('base:script step "badges": boom');
    expect(ctx.setCompleted).not.toHaveBeenCalled();
  });
});
