import type { StepImplementation } from "@scouterna/scoutin-plugin-api/backend";
import { type } from "arktype";
import { runScript } from "./runner.ts";

const Inputs = type({
  "variables?": "Record<string, unknown>",
  script: "string > 0",
});
type Inputs = typeof Inputs.infer;

/**
 * Runs a short synchronous inline JavaScript snippet and exposes its return
 * value as `outputs.result`. `variables` become globals of the script.
 */
export const script: StepImplementation = {
  id: "base:script",
  inputs: Inputs,
  hooks: {
    async onStepStart(ctx) {
      const inputs = ctx.getInputs() as Inputs;
      try {
        const result = runScript({
          code: inputs.script,
          variables: inputs.variables ?? {},
        });
        await ctx.setCompleted({ result });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`base:script step "${ctx.stepKey}": ${message}`);
      }
    },
  },
};
