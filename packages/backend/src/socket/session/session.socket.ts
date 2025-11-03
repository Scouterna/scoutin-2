import {
  createSocketRouter,
  type InferListeners,
  type RouteMiddleware,
} from "../socketRouter.ts";
import type { ServerMessage } from "./serverTypes.ts";
import { authRouter } from "./session.auth.ts";

export const router = createSocketRouter<ServerMessage>();

const requireAuth: RouteMiddleware<null, ServerMessage> = (
  c,
  evt,
  ws,
  next,
) => {
  const isAuthenticated = Boolean(c.get("wsSessionId"));
  if (!isAuthenticated) {
    console.warn("Unauthorized WebSocket message:", evt.data);
    ws.send({
      name: "auth",
      status: "failure",
      reason: "unauthorized",
    });
    return;
  }

  next();
};

const routes = router
  .use(authRouter)
  .bind("heartbeat", null, requireAuth, (_c, evt, _ws) => {
    console.log("Hi!", evt.data);
  });

export type Listeners = InferListeners<typeof routes>;
