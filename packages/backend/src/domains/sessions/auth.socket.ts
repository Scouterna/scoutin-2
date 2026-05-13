import { type } from "arktype";
import { authAttempts } from "../../app/metrics.ts";
import { prisma } from "../../app/prisma.ts";
import type { MessageTypes } from "../../core/websocket/messageTypes.ts";
import {
  createBroadcastWs,
  getConnectionCount,
  getLastScreen,
  registerConnection,
  terminateExistingConnections,
} from "../../core/websocket/sessionRegistry.ts";
import {
  createSocketRouter,
  type RouteMiddleware,
  type TypedWSContext,
} from "../../core/websocket/socketRouter.ts";
import { startStep } from "../../core/workflow/step.ts";
import {
  finalizeSession,
  getCurrentStep,
} from "../workflows/step.service.ts";
import { sendSessionInfo } from "./session.service.ts";
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
      name: "auth:status",
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
          name: "auth:status",
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
          name: "auth:status",
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
        select: { id: true, completedAt: true },
      });

      if (!session) {
        console.warn("WebSocket authentication failed: session not found");
        authAttempts.inc({ outcome: "session_not_found" });
        ws.send({
          name: "auth:status",
          data: {
            status: "failure",
            reason: "session_not_found",
          },
        });
        return;
      }

      c.set("wsSessionId", sessionId);

      const isFirstConnection = getConnectionCount(sessionId) === 0;

      if (!isFirstConnection) {
        // Admin takeover: terminate the kiosk (and any other existing connections)
        // so the device is freed up for someone else.
        terminateExistingConnections(sessionId, { name: "session:terminated" });
      }

      // Register this connection. Dead connections are cleaned up lazily when
      // broadcastToSession catches a failed send, but we also unregister eagerly
      // via wsUnregister when the WebSocket closes (see app.ts onClose).
      const unregister = registerConnection(sessionId, (msg) => ws.send(msg));
      c.set("wsUnregister", unregister);

      authAttempts.inc({ outcome: "success" });
      ws.send({
        name: "auth:status",
        data: {
          status: "success",
        },
      });
      await sendSessionInfo(sessionId, ws);
      console.log("WebSocket authenticated successfully");

      const broadcastWs = createBroadcastWs(
        sessionId,
      ) as unknown as TypedWSContext<MessageTypes>;

      if (session.completedAt) {
        broadcastWs.send({ name: "session:completed" });
        return;
      }

      const currentStep = await getCurrentStep(session.id);
      if (!currentStep) {
        // Crash recovery: all steps are done but the session was never finalized
        // (e.g. connection dropped between completing the last step and sending
        // session:completed). Finalize now so required steps are still checked.
        await finalizeSession(session.id);
        broadcastWs.send({ name: "session:completed" });
        return;
      }

      if (isFirstConnection) {
        await startStep(c, broadcastWs, currentStep);
      } else {
        // Admin took over. Replay the last screen so the admin sees current state.
        // If no screen has been shown yet (e.g. the previous connection died before
        // onStepStart could call showScreen), fall back to starting the step fresh.
        const lastScreen = getLastScreen(sessionId);
        if (lastScreen) {
          ws.send({ name: "step:showScreen", data: lastScreen });
        } else {
          await startStep(c, broadcastWs, currentStep);
        }
      }
    },
  )
  .bind("auth:clear", null, (c, _evt, ws) => {
    c.set("wsSessionId", undefined);
    ws.send({
      name: "auth:status",
      data: {
        status: "cleared",
      },
    });
    console.log("WebSocket authentication cleared");
  });
