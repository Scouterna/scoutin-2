import { type } from "arktype";

export const StepDefinition = type({
  /**
   * Which step to use. Format is `<module>:<step>`.
   */
  uses: "string",
  /**
   * An identifier for the step. This can be used to reference outputs from this
   * step in later steps. Must be unique within the flow except for steps that
   * are conditionally run (i.e. have an `if` field). If two conditional steps
   * share the same ID they must have the same `uses` value.
   */
  "id?": "string",
  /**
   * Options to pass to the step.
   */
  "with?": "Record<string, unknown>",
  /**
   * A condition that must be true for the step to run. Uses the same syntax as
   * GitHub Actions expressions.
   *
   * https://docs.github.com/en/actions/reference/workflows-and-actions/expressions.
   */
  "if?": "string",
});

export type StepDefinition = typeof StepDefinition.infer;

export const StepConfig = type({
  steps: type(StepDefinition).array().atLeastLength(1),
});

export type StepConfig = typeof StepConfig.infer;
