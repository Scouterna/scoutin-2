import type { Context, Next } from "hono";
import {
  createSocketRouter,
  type RouteMiddleare,
  type TypedWSContext,
} from "../socketRouter.ts";
import type { ClientMessage } from "./clientTypes.ts";
import type { ServerAuth, ServerMessage } from "./serverTypes.ts";
import type { WSMessageReceive } from "hono/ws";

export const router = createSocketRouter<ClientMessage, ServerMessage>();

const requireAuth: RouteMiddleare<unknown, ServerMessage> = (
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

router.bind("auth", (c, evt, ws) => {
  if (evt.data.token) {
    // In a real application, you'd verify the token here.
    c.set("wsSessionId", evt.data.token); // Using token as session ID for demo purposes.

    const response: ServerAuth = {
      name: "auth",
      status: "success",
    };
    ws.send(response);
    console.log("WebSocket authenticated successfully");
  } else {
    const response: ServerAuth = {
      name: "auth",
      status: "failure",
      reason: "missing_token",
    };
    ws.send(response);
    console.warn("WebSocket authentication failed: missing token");
  }
});

router.bind("heartbeat", requireAuth, (_c, evt, _ws) => {
  console.log("Hi!", evt.data);
});
