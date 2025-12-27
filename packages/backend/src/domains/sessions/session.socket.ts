import { type } from "arktype";
import { prisma } from "../../app/prisma.ts";
import type { MessageTypes } from "../../core/websocket/messageTypes.ts";
import {
  createSocketRouter,
  type InferListeners,
} from "../../core/websocket/socketRouter.ts";
import { createStepContext } from "../../core/workflow/stepContext.ts";
import { getNextStep } from "../workflows/step.service.ts";
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
      inputs: "object",
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
      const nextStep = await getNextStep(session);
      const step = stepRegistry.get(nextStep.uses);
      const ctx = createStepContext(ws);

      const method = step?.publicMethods?.[evt.data.name];
      if (!method) {
        throw new Error(
          `Method ${evt.data.name} not found on step ${step?.id}`,
        );
      }

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

      await method.handler(ctx, validationResult.value);
    },
  );

export type Listeners = InferListeners<typeof routes>;
