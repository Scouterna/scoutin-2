import {
  createSocketRouter,
  type InferListeners,
  type RouteMiddleware,
} from "../socketRouter.ts";
import type { MessageTypes } from "./messageTypes.ts";
import { authRouter } from "./session.auth.ts";

export const router = createSocketRouter<MessageTypes>();

const requireAuth: RouteMiddleware<null, MessageTypes> = (c, evt, ws, next) => {
  const isAuthenticated = Boolean(c.get("wsSessionId"));
  if (!isAuthenticated) {
    console.warn("Unauthorized WebSocket message:", evt.data);
    ws.send({
      name: "auth",
      data: {
        status: "failure",
        reason: "unauthorized",
      },
    });
    return;
  }

  next();
};

const routes = router
  .use(authRouter)
  .bind("heartbeat", null, requireAuth, (_c, evt, ws) => {
    console.log("Hi!", evt.data);
    ws.send({
      name: "heartbeat",
    });
  });

export type Listeners = InferListeners<typeof routes>;
