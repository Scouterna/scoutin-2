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
        throw new Error(`Method ${evt.data.name} not found on step ${step.id}`);
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
  });

export type Listeners = InferListeners<typeof routes>;
