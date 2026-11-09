import type { StepImplementation } from "@scouterna/scoutin-plugin-api/backend";
import { type } from "arktype";
import { runScript } from "./runner.ts";

const Inputs = type({
  "variables?": "Record<string, unknown>",
  script: "string > 0",
});
type Inputs = typeof Inputs.infer;

// setCompleted keeps only declared outputs; without this, `result` is dropped.
const Outputs = type({ result: "unknown" });

/**
 * Runs a short synchronous inline JavaScript snippet and exposes its return
 * value as `outputs.result`. `variables` become globals of the script.
 */
export const script: StepImplementation = {
  id: "base:script",
  inputs: Inputs,
  outputs: Outputs,
  hooks: {
    async onStepStart(ctx) {
      const inputs = ctx.getInputs() as Inputs;
      let result: unknown;
      try {
        result = runScript({
          code: inputs.script,
          variables: inputs.variables ?? {},
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`base:script step "${ctx.stepKey}": ${message}`);
      }
      // Outside the try: setCompleted starts the next step, whose errors
      // aren't this script's.
      await ctx.setCompleted({ result });
    },
  },
};
