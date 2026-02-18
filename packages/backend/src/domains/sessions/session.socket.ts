import { type } from "arktype";
import { stepMethodCallSeconds } from "../../app/metrics.ts";
import { prisma } from "../../app/prisma.ts";
import type { MessageTypes } from "../../core/websocket/messageTypes.ts";
import {
  createSocketRouter,
  type InferListeners,
} from "../../core/websocket/socketRouter.ts";
import { createStepContext } from "../../core/workflow/stepContext.ts";
import { getCurrentStep } from "../workflows/step.service.ts";
import { stepRegistry } from "../workflows/steps.ts";
import { authRouter, requireAuth } from "./auth.socket.ts";

export const router = createSocketRouter<MessageTypes>();

const routes = router
  .use(authRouter)
  .bind("heartbeat", null, requireAuth, (_c, evt, ws) => {
    console.log("Hi!", evt.data);
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
    async (c, evt, ws) => {
      // TODO: Making roundtrips to the database for this is insanity. Current step should be stored in the session context.
      const sessionId = c.get("wsSessionId");
      const session = await prisma.checkinSession.findUnique({
        where: { id: sessionId },
      });
      if (!session) {
        throw new Error("Session not found");
      }
      // TODO: There is a lot going on here, refactor.
      const currentStep = await getCurrentStep(session);
      const step = stepRegistry.get(currentStep.uses);
      if (!step) {
        throw new Error(`Step implementation ${currentStep.uses} not found`);
      }

      const ctx = createStepContext(c, ws, step);

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
  );

export type Listeners = InferListeners<typeof routes>;
