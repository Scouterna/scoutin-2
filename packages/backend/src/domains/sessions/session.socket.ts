import { type } from "arktype";
import { stepMethodCallSeconds } from "../../app/metrics.ts";
import { getLogger } from "../../core/logging/logger.ts";
import type { MessageTypes } from "../../core/websocket/messageTypes.ts";
import { createBroadcastWs } from "../../core/websocket/sessionRegistry.ts";
import {
  createSocketRouter,
  type InferListeners,
  type TypedWSContext,
} from "../../core/websocket/socketRouter.ts";
import { goBack } from "../../core/workflow/step.ts";
import { createStepContext } from "../../core/workflow/stepContext.ts";
import { getCurrentStep } from "../workflows/step.service.ts";
import { stepRegistry } from "../workflows/steps.ts";
import { authRouter, requireAuth } from "./auth.socket.ts";
import { abortSession } from "./session.service.ts";

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

    await abortSession(sessionId);

    const broadcastWs = createBroadcastWs(
      sessionId,
    ) as unknown as TypedWSContext<MessageTypes>;
    broadcastWs.send({ name: "session:terminated" });
  });

export type Listeners = InferListeners<typeof routes>;
