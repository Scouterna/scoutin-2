import type { StandardSchemaV1 } from "@standard-schema/spec";

// Step implementation types
export type SetActorOptions =
  | {
      participantId: string;
    }
  | {
      administrator: true;
    };

export type SetSubjectsOptions = {
  participantIds: string[];
};

export type StepMethodContext<TState = Record<string, unknown>> = {
  sessionId: string;
  sendMessage(name: string, payload?: Record<string, unknown>): Promise<void>;
  setCompleted(outputs?: Record<string, unknown>): Promise<void>;
  showScreen(
    screenId: string,
    payload?: Record<string, unknown>,
  ): Promise<void>;
  getInputs(): Record<string, unknown>;
  setState(key: keyof TState, value: TState[keyof TState]): void;
  getState(key: keyof TState): TState[keyof TState];
  clearState(): void;
  setActor(options: SetActorOptions): Promise<void>;
  clearActor(): Promise<void>;
  getActor(): Promise<
    | {
        actor: { id: string };
        participant: {
          id: string;
          firstName: string;
          lastName: string;
          dataSource: string;
        };
      }
    // | { administrator: true }
    | null
  >;
  setSubjects(options: SetSubjectsOptions): Promise<void>;
  clearSubjects(): Promise<void>;
  overrideSession(newSessionId: string): void;
  restartStep(): Promise<void>;
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
  skipOnGoBack?: boolean;
  inputs?: StandardSchemaV1<Record<string, unknown>, Record<string, unknown>>;
  outputs?: StandardSchemaV1<Record<string, unknown>, Record<string, unknown>>;
  hooks?: {
    onStepStart?(context: StepMethodContext<TState>): Promise<void> | void;
    onStepRollback?(context: StepMethodContext<TState>): Promise<void> | void;
  };
  publicMethods?: {
    [method: string]: StepImplementationMethod<TState>;
  };
};

// Typed method utility
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

// Backend plugin types
export type BackendPluginContext = {
  registerStep(step: StepImplementation): void;
};

export type BackendPlugin = {
  setup(ctx: BackendPluginContext): void;
};
