import type { Context } from "hono";
import type { AppUser } from "../../domains/auth/auth.service.ts";
import type { Logger } from "../logging/logger.ts";
import type { MessageTypes } from "./messageTypes.ts";

// TODO: This doesn't belong here since it's applicable for the whole app and not just websockets.
export type AppEnv = {
  Variables: {
    wsSessionId?: string;
    wsUnregister?: () => void;
    /**
     * Raw send for this specific connection (not a broadcast). Stored so that
     * `overrideSession` can re-register the live connection under the new
     * session id — otherwise broadcasts for the new session would never reach
     * this kiosk. See stepContext.overrideSession.
     */
    wsSend?: (message: MessageTypes) => void;
    stepMeta?: {
      idInFlow?: string;
      evaluatedInputs?: Record<string, unknown>;
    };
    stepState?: Record<string, unknown>;
    logger?: Logger;
    connId?: string;
    reqId?: string;
    /** The authenticated admin user, set by the role guards (requireStaff etc.). */
    user?: AppUser;
  };
};

export type TypedContext = Context<AppEnv>;
