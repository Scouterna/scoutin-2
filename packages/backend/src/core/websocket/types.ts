import type { Context } from "hono";

// TODO: This doesn't belong here since it's applicable for the whole app and not just websockets.
export type TypedContext = Context<{
  Variables: {
    wsSessionId?: string;
    wsUnregister?: () => void;
    stepMeta?: {
      idInFlow?: string;
      evaluatedInputs?: Record<string, unknown>;
    };
    stepState?: Record<string, unknown>;
  };
}>;
