import { type } from "arktype";
import { Hono } from "hono";
import {
  activeWebSocketConnections,
  stepMethodCallSeconds,
} from "../../app/metrics.ts";
import { getLogger, logger } from "../../core/logging/logger.ts";
import type { MessageTypes } from "../../core/websocket/messageTypes.ts";
import {
  createBroadcastWs,
  isNavigationLocked,
} from "../../core/websocket/sessionRegistry.ts";
import {
  createSocketRouter,
  type InferListeners,
  type TypedWSContext,
} from "../../core/websocket/socketRouter.ts";
import type { AppEnv, UpgradeWebSocket } from "../../core/websocket/types.ts";
import { goBack, sendNavigationState } from "../../core/workflow/step.ts";
import { createStepContext } from "../../core/workflow/stepContext.ts";
import { getCurrentStep } from "../workflows/step.service.ts";
import { stepRegistry } from "../workflows/steps.ts";
import { authRouter, requireAuth } from "./auth.socket.ts";
import { abortSession } from "./session.service.ts";

/**
 * While a step holds the navigation lock, a kiosk must not leave it. The kiosk
 * screen hides its back button, but that is only a courtesy: `step:goBack` and
 * `session:abort` can be sent directly, so the backend enforces it too.
 *
 * Call this first in those handlers. If the session is locked and the connection
 * is not staff, it logs, re-sends the navigation state (so a stale screen hides
 * its back button) and returns true, meaning the caller must stop. Otherwise it
 * does nothing and returns false.
 */
async function refuseIfLocked(
  c: Parameters<typeof getLogger>[0],
  sessionId: string,
  action: string,
): Promise<boolean> {
  if (!isNavigationLocked(sessionId) || c.get("wsRole") === "staff") {
    return false;
  }
  getLogger(c).warn({ action }, "Rejected while navigation is locked");
  await sendNavigationState(sessionId);
  return true;
}

export const router = createSocketRouter<MessageTypes>();

const routes = router
  .use(authRouter)
  .bind("heartbeat", null, (_c, _evt, ws) => {
    ws.send({
      name: "heartbeat",
    });
  })
  .bind(
    "step:callMethod",
    type({
      name: "string",
      "inputs?": "object",
    }),
    requireAuth,
    async (c, evt, _ws) => {
      const sessionId = c.get("wsSessionId");
      if (!sessionId) {
        throw new Error("No session ID found in context");
      }

      const currentStep = await getCurrentStep(sessionId);
      if (!currentStep) {
        getLogger(c).warn("No current step found for session");
        return;
      }

      const step = stepRegistry.get(currentStep.uses);
      if (!step) {
        throw new Error(`Step implementation ${currentStep.uses} not found`);
      }

      const broadcastWs = createBroadcastWs(
        sessionId,
      ) as unknown as TypedWSContext<MessageTypes>;
      const ctx = createStepContext(c, broadcastWs, step);

      const method = step.publicMethods?.[evt.data.name];
      if (!method) {
        // A method call inherently races step advancement: e.g. an operator
        // double-clicks a button whose first click already completed the step,
        // so the second call arrives after the session has moved on to a step
        // that doesn't define this method. That's an expected race, not a
        // server fault, so we log and ignore it rather than throwing — which
        // would surface to the kiosk as a spurious "Internal server error" +
        // reload toast (the first call already did the real work).
        getLogger(c).warn(
          { method: evt.data.name, stepId: step.id },
          "Ignoring method call not defined on the current step (likely a stale or duplicate call after step advancement)",
        );
        return;
      }

      let validatedInputs: unknown;

      if (method.inputs) {
        const validationResult = await method.inputs["~standard"].validate(
          evt.data.inputs,
        );
        if (validationResult.issues) {
          throw new Error(
            `Invalid inputs for method ${evt.data.name}: ${JSON.stringify(
              validationResult.issues,
            )}`,
          );
        }

        validatedInputs = validationResult.value;
      }

      const endTimer = stepMethodCallSeconds.startTimer({
        step_id: step.id,
        method_name: evt.data.name,
      });

      try {
        await method.handler(ctx, validatedInputs);
      } finally {
        endTimer();
      }
    },
  )
  .bind("step:goBack", null, requireAuth, async (c, _evt, _ws) => {
    const sessionId = c.get("wsSessionId");
    if (!sessionId) {
      throw new Error("No session ID found in context");
    }
    if (await refuseIfLocked(c, sessionId, "step:goBack")) return;
    const broadcastWs = createBroadcastWs(
      sessionId,
    ) as unknown as TypedWSContext<MessageTypes>;
    await goBack(c, broadcastWs);
  })
  .bind("session:abort", null, requireAuth, async (c, _evt, _ws) => {
    const sessionId = c.get("wsSessionId");
    if (!sessionId) {
      throw new Error("No session ID found in context");
    }

    if (await refuseIfLocked(c, sessionId, "session:abort")) return;

    await abortSession(sessionId);

    const broadcastWs = createBroadcastWs(
      sessionId,
    ) as unknown as TypedWSContext<MessageTypes>;
    broadcastWs.send({ name: "session:terminated" });
  });

export type Listeners = InferListeners<typeof routes>;

/** The kiosk session WebSocket, mounted at /ws/session. */
export function sessionSocket(upgradeWebSocket: UpgradeWebSocket) {
  return new Hono<AppEnv>().get(
    "/",
    upgradeWebSocket(async (c) => {
      // Simulate delay for testing purposes
      // await new Promise((resolve) => setTimeout(resolve, 1500));

      const connId = crypto.randomUUID();
      c.set("connId", connId);
      c.set("logger", logger.child({ connId }));

      getLogger(c).info("WebSocket connection opened");
      activeWebSocketConnections.inc();

      return {
        onMessage: router.onMessage(c),
        onClose() {
          activeWebSocketConnections.dec();
          getLogger(c).info("WebSocket connection closed");
          c.get("wsUnregister")?.();
        },
      };
    }),
  );
}
