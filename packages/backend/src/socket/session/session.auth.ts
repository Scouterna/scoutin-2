import { type } from "arktype";
import { createSocketRouter, type RouteMiddleware } from "../socketRouter.ts";
import type { MessageTypes } from "./messageTypes.ts";

export const requireAuth: RouteMiddleware<null, MessageTypes> = (
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
      data: {
        status: "failure",
        reason: "unauthorized",
      },
    });
    return;
  }

  next();
};
export const authRouter = createSocketRouter<MessageTypes>().bind(
  "auth",
  type({
    token: "string",
  }),
  (c, evt, ws) => {
    if (evt.data.token) {
      // In a real application, you'd verify the token here.
      c.set("wsSessionId", evt.data.token); // Using token as session ID for demo purposes.

      ws.send({
        name: "auth",
        data: {
          status: "success",
        },
      });
      console.log("WebSocket authenticated successfully");
    } else {
      ws.send({
        name: "auth",
        data: {
          status: "failure",
          reason: "missing_token",
        },
      });
      console.warn("WebSocket authentication failed: missing token");
    }
  },
);
