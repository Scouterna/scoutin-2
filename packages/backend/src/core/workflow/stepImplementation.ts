import type { StandardSchemaV1 } from "@standard-schema/spec";

export type StepMethodContext<TState = Record<string, unknown>> = {
  sendMessage(name: string, payload?: Record<string, unknown>): Promise<void>;
  setCompleted(outputs?: Record<string, unknown>): Promise<void>;
  showScreen(
    screenId: string,
    payload?: Record<string, unknown>,
  ): Promise<void>;
  setState(key: keyof TState, value: TState[keyof TState]): void;
  getState(key: keyof TState): TState[keyof TState];
  clearState(): void;
};

export type StepImplementationMethod<TState> = {
  inputs?: StandardSchemaV1<Record<string, unknown>, Record<string, unknown>>;
  handler(
    context: StepMethodContext<TState>,
    inputs: unknown,
  ): Promise<void> | void;
};

export type StepImplementation<
  TState extends Record<string, unknown> = Record<string, unknown>,
> = {
  id: string;
  inputs?: StandardSchemaV1<Record<string, unknown>, Record<string, unknown>>;
  outputs?: StandardSchemaV1<Record<string, unknown>, Record<string, unknown>>;
  hooks?: {
    onStepStart?(context: StepMethodContext<TState>): Promise<void> | void;
  };
  publicMethods?: {
    [method: string]: StepImplementationMethod<TState>;
  };
};
