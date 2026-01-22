import type { StandardSchemaV1 } from "@standard-schema/spec";

export type StepMethodContext = {
  sendMessage(name: string, payload?: Record<string, unknown>): Promise<void>;
  setCompleted(outputs?: Record<string, unknown>): Promise<void>;
  showScreen(
    screenId: string,
    payload?: Record<string, unknown>,
  ): Promise<void>;
};

export type StepImplementationMethod = {
  inputs: StandardSchemaV1<object, object>;
  handler(context: StepMethodContext, inputs: unknown): Promise<void> | void;
};

export type StepImplementation = {
  id: string;
  inputs?: StandardSchemaV1<object, object>;
  outputs?: StandardSchemaV1<object, object>;
  hooks?: {
    onStepStart?(context: StepMethodContext): Promise<void> | void;
  };
  publicMethods?: {
    [method: string]: StepImplementationMethod;
  };
};
