import type { StandardSchemaV1 } from "@standard-schema/spec";

export {
  coerceLanguage,
  DEFAULT_LANGUAGE,
  isSupportedLanguage,
  LANGUAGE_LABELS,
  type Language,
  LocalizedString,
  resolveLocalized,
  SUPPORTED_LANGUAGES,
} from "../i18n.ts";

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
  /**
   * The language this session is being conducted in (e.g. `"sv"`, `"en"`).
   *
   * Localized `{ sv, en }` maps in the step config are already collapsed to
   * plain strings before `getInputs()` sees them, so this is only needed for
   * text a step generates in code - resolve it with `resolveLocalized()`.
   */
  readonly language: string;
  /**
   * Changes the session language. Persists to the session and notifies the
   * client so its own strings switch too. Subsequent steps get their config
   * text resolved in the new language.
   */
  setLanguage(language: string): Promise<void>;
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
  /**
   * Persists durable, step-produced data onto a participant, namespaced under
   * this step's `id` in the participant's `resultData` store. The output-side
   * counterpart to import `metadata`: use it to write results a step computes
   * during a session (e.g. a handed-out RFID tag) back onto the person, so the
   * participant row stays the single source of truth rather than duplicating
   * into session/step state.
   *
   * Each step owns exactly one key (its own id); the write merges that key
   * without touching any other step's data (or the import `metadata`). Reading
   * back / querying across participants is a plain Prisma read against
   * `resultData` - this only encapsulates the namespaced-merge write discipline.
   */
  writeResultData(participantId: string, value: unknown): Promise<void>;
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
  /** The raw record fetched from the provider for this entity during the
   * current import cycle (e.g. the raw Scoutnet member object, before
   * validation stripped it down to `EnrichableEntity`), or `undefined` if the
   * provider doesn't expose one (e.g. Google Sheets) or none was captured for
   * this entity. Lets an enricher read provider fields that aren't part of
   * the app's own data model without a second API call. */
  sourceRecord?: unknown;
  /** Static, per-entry config from the data source's `enrichWith` entry (the
   * object form: `{ name: "...", options: {...} }`), or `undefined` when the
   * entry used the bare-string form. Lets a single enricher be reused across
   * events with event-specific parameters (e.g. Scoutnet registration
   * question IDs), instead of hardcoding them in the enricher itself. */
  options?: Record<string, unknown>;
  /** Optional per-import-cycle context shared across every entity of this
   * data source (unlike `sourceRecord`, which is per-entity) - e.g.
   * Scoutnet's question-ID -> choice-ID -> human-readable label lookup,
   * fetched once per cycle rather than once per entity. `undefined` if the
   * provider doesn't expose one. */
  providerContext?: unknown;
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
