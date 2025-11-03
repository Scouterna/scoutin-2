import { type } from "arktype";
import { createSocketRouter, type RouteMiddleware } from "../socketRouter.ts";
import type { ServerAuth, ServerMessage } from "./serverTypes.ts";

export const requireAuth: RouteMiddleware<null, ServerMessage> = (
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
export const authRouter = createSocketRouter<ServerMessage>().bind(
  "auth",
  type({
    token: "string",
  }),
  (c, evt, ws) => {
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
  },
);
