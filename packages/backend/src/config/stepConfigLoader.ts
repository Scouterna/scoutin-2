import { type } from "arktype";
import { parse } from "yaml";
import { StepConfig } from "./stepConfig.ts";

export function loadStepConfig(stepConfigString: string) {
  const rawStepConfig = parse(stepConfigString);
  const stepConfig = StepConfig(rawStepConfig);

  if (stepConfig instanceof type.errors) {
    throw new Error(
      `Step configuration validation failed:\n${stepConfig.summary}`,
    );
  }

  // TODO: Move this into a bigger schema validation function. For now this is a
  // plain runtime guard to catch the silent bug where two steps share `uses`
  // without unique `id`s — without `id` the completion lookup falls back to
  // matching by `uses`, so the second step would always appear already completed.
  const seen = new Map<string, number>();
  for (let i = 0; i < stepConfig.steps.length; i++) {
    const step = stepConfig.steps[i]!;
    const key = step.id ?? `__uses__${step.uses}`;
    const prev = seen.get(key);
    if (prev !== undefined) {
      if (!step.id) {
        throw new Error(
          `Step config error: steps at index ${prev} and ${i} both use "${step.uses}" without a unique "id". ` +
            `Add an "id" to each occurrence so completions can be tracked separately.`,
        );
      }
      throw new Error(
        `Step config error: steps at index ${prev} and ${i} share id "${step.id}". Step ids must be unique.`,
      );
    }
    seen.set(key, i);
  }

  return stepConfig;
}
