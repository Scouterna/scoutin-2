import { type } from "arktype";
import { authAttempts } from "../../app/metrics.ts";
import { prisma } from "../../app/prisma.ts";
import type { MessageTypes } from "../../core/websocket/messageTypes.ts";
import {
  createSocketRouter,
  type RouteMiddleware,
} from "../../core/websocket/socketRouter.ts";
import { executeStep } from "../../core/workflow/step.ts";
import { getNextStep } from "../workflows/step.service.ts";
import { verifyJWT } from "./tokens.ts";

export const requireAuth: RouteMiddleware<null, MessageTypes> = async (
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

  await next();
};

export const authRouter = createSocketRouter<MessageTypes>()
  .bind(
    "auth:authenticate",
    type({
      token: "string",
    }),
    async (c, evt, ws) => {
      if (!evt.data.token) {
        console.warn("WebSocket authentication failed: missing token");
        authAttempts.inc({ outcome: "missing_token" });
        ws.send({
          name: "auth",
          data: {
            status: "failure",
            reason: "missing_token",
          },
        });
        return;
      }

      const token = await verifyJWT(evt.data.token);

      if (!token?.valid) {
        console.warn("WebSocket authentication failed: invalid token");
        authAttempts.inc({ outcome: "invalid_token" });
        ws.send({
          name: "auth",
          data: {
            status: "failure",
            reason: "invalid_token",
          },
        });
        return;
      }

      const sessionId = token.payload["urn:scoutid:sessionId"];

      // TODO: I think it might be better to emit an internal "authenticated"
      // event on an internal event bus and then react to that event somewhere
      // else to send the current step. But I don't know if it's totally
      // necessary to add that complexity, so for now I'm doing it here.

      const session = await prisma.checkinSession.findUnique({
        where: { id: sessionId },
      });

      if (!session) {
        console.warn("WebSocket authentication failed: session not found");
        authAttempts.inc({ outcome: "session_not_found" });
        ws.send({
          name: "auth",
          data: {
            status: "failure",
            reason: "session_not_found",
          },
        });
        return;
      }

      c.set("wsSessionId", sessionId);

      authAttempts.inc({ outcome: "success" });
      ws.send({
        name: "auth",
        data: {
          status: "success",
        },
      });
      console.log("WebSocket authenticated successfully");

      const nextStep = await getNextStep(session);
      await executeStep(c, ws, nextStep);
    },
  )
  .bind("auth:clear", null, (c, _evt, ws) => {
    c.set("wsSessionId", undefined);
    ws.send({
      name: "auth",
      data: {
        status: "cleared",
      },
    });
    console.log("WebSocket authentication cleared");
  });
