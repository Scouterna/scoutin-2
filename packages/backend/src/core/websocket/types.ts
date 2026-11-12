import type { createNodeWebSocket } from "@hono/node-ws";
import type { Context } from "hono";
import type { ApiPermission } from "../../domains/apiKeys/apiKeys.service.ts";
import type { AppUser } from "../../domains/auth/auth.service.ts";
import type { SessionRole } from "../../domains/sessions/tokens.ts";
import type { Logger } from "../logging/logger.ts";
import type { MessageTypes } from "./messageTypes.ts";

// TODO: This doesn't belong here since it's applicable for the whole app and not just websockets.
export type AppEnv = {
  Variables: {
    wsSessionId?: string;
    /** Role from the verified session token; absent until authenticated. */
    wsRole?: SessionRole;
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
    /** The print relay authenticated on a /ws/print-relay upgrade. */
    printRelayId?: string;
    /** The API key authenticated by requireApiKey on /api/public. */
    apiKey?: { id: string; name: string; permissions: ApiPermission[] };
  };
};

export type TypedContext = Context<AppEnv>;

/**
 * The upgrade helper from createNodeWebSocket. It's created in app.ts and
 * handed to the socket routers, which can't import it from there without an
 * import cycle.
 */
export type UpgradeWebSocket = ReturnType<
  typeof createNodeWebSocket
>["upgradeWebSocket"];
