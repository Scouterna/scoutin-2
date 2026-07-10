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

export type StepLogger = {
  debug(msg: string, ...args: unknown[]): void;
  debug(obj: object, msg?: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  info(obj: object, msg?: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  warn(obj: object, msg?: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  error(obj: object, msg?: string, ...args: unknown[]): void;
};

export type StepMethodContext<TState = Record<string, unknown>> = {
  sessionId: string;
  logger: StepLogger;
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

// Import enricher types

/**
 * The subset of a Participant/ParticipantGroup row an enricher gets to read.
 * Intentionally structural (no Prisma import here) so plugin-api stays
 * dependency-free; the backend adapts its DB rows to this shape.
 */
export type EnrichableEntity = {
  id: string;
  dataSource: string;
  idInDataSource: string;
  name?: string; // groups
  firstName?: string; // participants
  lastName?: string;
  subGroup?: string | null;
};

export type ImportEnricherContext = {
  dataSourceName: string;
  logger: StepLogger;
};

export type ImportEnricher = {
  /** Namespaced, e.g. "stormote6:villageLookup". Referenced by name from a
   * data source's `enrichWith` config map. */
  name: string;
  target: "participant" | "group";
  /** Return a value to write to `metadata[key]` (key comes from `enrichWith`),
   * or null/undefined for "no data for this entity" (not an error - no key is
   * written). Throwing flags the entity with hasImportError. */
  enrich(
    entity: EnrichableEntity,
    ctx: ImportEnricherContext,
  ): Promise<unknown | null | undefined> | unknown | null | undefined;
};

// Backend plugin types
export type BackendPluginContext = {
  registerStep(step: StepImplementation): void;
  registerImportEnricher(enricher: ImportEnricher): void;
};

export type BackendPlugin = {
  setup(ctx: BackendPluginContext): void;
};
