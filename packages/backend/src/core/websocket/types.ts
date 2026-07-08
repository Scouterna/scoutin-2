import type { Context } from "hono";
import type { Logger } from "../logging/logger.ts";

// TODO: This doesn't belong here since it's applicable for the whole app and not just websockets.
export type AppEnv = {
  Variables: {
    wsSessionId?: string;
    wsUnregister?: () => void;
    stepMeta?: {
      idInFlow?: string;
      evaluatedInputs?: Record<string, unknown>;
    };
    stepState?: Record<string, unknown>;
    logger?: Logger;
    connId?: string;
    reqId?: string;
  };
};

export type TypedContext = Context<AppEnv>;
