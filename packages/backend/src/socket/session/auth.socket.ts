import { type } from "arktype";
import { getNextStep } from "../../api/step/step.service.ts";
import { prisma } from "../../prisma.ts";
import { stepRegistry } from "../../steps/steps.ts";
import { verifyJWT } from "../../tokens.ts";
import { createSocketRouter, type RouteMiddleware } from "../socketRouter.ts";
import type { MessageTypes } from "./messageTypes.ts";
import { createStepContext } from "../../steps/stepContext.ts";

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

export const authRouter = createSocketRouter<MessageTypes>()
  .bind(
    "auth:authenticate",
    type({
      token: "string",
    }),
    async (c, evt, ws) => {
      if (!evt.data.token) {
        console.warn("WebSocket authentication failed: missing token");
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

      ws.send({
        name: "auth",
        data: {
          status: "success",
        },
      });
      console.log("WebSocket authenticated successfully");

      const nextStep = await getNextStep(session);
      const step = stepRegistry.get(nextStep.uses);
      const ctx = createStepContext(ws);
      await step?.hooks?.onStepStart?.(ctx);
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
