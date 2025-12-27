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

  return stepConfig;
}
