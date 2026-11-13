import { type } from "arktype";

/**
 * How the kiosk lays out the screens of a step. Sent to the client with every
 * `step:showScreen`.
 */
export const StepLayout = type({
  "+": "reject",
  /**
   * Space above the screen content. `small` suits screens with a lot of
   * content. Defaults to `default`.
   */
  "topPadding?": "'none' | 'small' | 'default'",
});

export type StepLayout = typeof StepLayout.infer;

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
  /**
   * If true, this step must have a completion record for the session to be
   * considered complete. Steps that are conditionally skipped (via `if`) are
   * exempt — only steps whose condition was truthy (or had no condition) are
   * checked.
   */
  "required?": "boolean",
  /**
   * Kiosk layout for this step's screens.
   */
  "layout?": StepLayout,
});

export type StepDefinition = typeof StepDefinition.infer;

export const StepConfig = type({
  steps: type(StepDefinition).array().atLeastLength(1),
});

export type StepConfig = typeof StepConfig.infer;
