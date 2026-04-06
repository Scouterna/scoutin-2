import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useRef } from "react";

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
  setState(key: keyof TState, value: TState[keyof TState]): void;
  getState(key: keyof TState): TState[keyof TState];
  clearState(): void;
  setActor(options: SetActorOptions): Promise<void>;
  clearActor(): Promise<void>;
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

// Plugin socket
export interface PluginSocket {
  send(message: { name: string; data?: unknown }): void;
  /** Subscribe to a named step message. Returns an unsubscribe function. */
  onMessage(name: string, handler: (payload: object) => void): () => void;
}

export const PluginSocketContext = createContext<PluginSocket | null>(null);

export function usePluginSocket(): PluginSocket | null {
  return useContext(PluginSocketContext);
}

export function usePluginMessage(
  name: string,
  handler: (payload: object) => void,
) {
  const socket = usePluginSocket();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!socket) return;
    return socket.onMessage(name, (payload) => handlerRef.current(payload));
  }, [socket, name]);
}

// Frontend plugin types
export type ScreenConfig = {
  name: string;
  component: ({ payload }: { payload: object }) => ReactNode;
};

export type FrontendPluginContext = {
  registerScreen(screen: ScreenConfig): void;
};

export type FrontendPlugin = {
  setup(ctx: FrontendPluginContext): void;
};
