import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { StepMethodContext } from "../core/workflow/stepImplementation.ts";

export function typedMethod<
  TInputs extends StandardSchemaV1<object, object>,
  TState,
>({
  inputs,
  handler,
}: {
  inputs?: TInputs;
  handler(
    context: StepMethodContext<TState>,
    inputs: NonNullable<TInputs["~standard"]["types"]>["output"],
  ): Promise<void> | void;
}) {
  return {
    inputs,
    handler,
  };
}
