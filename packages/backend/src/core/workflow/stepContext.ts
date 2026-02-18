import { stepCompletions } from "../../app/metrics.ts";
import { prisma } from "../../app/prisma.ts";
import {
  completeStep,
  getCurrentStep,
} from "../../domains/workflows/step.service.ts";
import type { MessageTypes } from "../websocket/messageTypes.ts";
import type { TypedWSContext } from "../websocket/socketRouter.ts";
import type { TypedContext } from "../websocket/types.ts";
import { startStep } from "./step.ts";
import type {
  StepImplementation,
  StepMethodContext,
} from "./stepImplementation.ts";

export function createStepContext(
  c: TypedContext,
  ws: TypedWSContext<MessageTypes>,
  stepImplementation: StepImplementation,
): StepMethodContext {
  const sessionId = c.get("wsSessionId");
  if (!sessionId) {
    throw new Error("No session ID found in context");
  }

  return {
    sessionId,
    async sendMessage(name, payload = {}) {
      await ws.send({
        name: "stepMessage",
        data: { name, payload },
      });
    },
    async setCompleted(outputs: Record<string, unknown> = {}) {
      // TODO: This method is doing too much.
      let validatedOutputs: Record<string, unknown> = {};

      if (stepImplementation.outputs) {
        const validationResult =
          await stepImplementation.outputs["~standard"].validate(outputs);

        if (validationResult.issues) {
          throw new Error(
            `Invalid outputs for step "${stepImplementation.id}": ${JSON.stringify(
              validationResult.issues,
            )}`,
          );
        }

        validatedOutputs = validationResult.value;
      }

      const sessionId = c.get("wsSessionId");
      if (!sessionId) {
        throw new Error("No session ID found in context");
      }

      const stepMeta = c.get("stepMeta");
      if (!stepMeta) {
        throw new Error("No step metadata found in context");
      }

      stepCompletions.inc({ step_id: stepImplementation.id });

      const { session } = await completeStep(
        sessionId,
        stepImplementation.id,
        stepMeta.idInFlow,
        stepMeta.evaluatedInputs,
        validatedOutputs,
      );

      const currentStep = await getCurrentStep(session);
      await startStep(c, ws, currentStep);
    },
    setState(key, value) {
      c.set("stepState", {
        ...c.get("stepState"),
        [key]: value,
      });
    },
    getState(key) {
      const state = c.get("stepState") || {};
      return state[key];
    },
    clearState() {
      c.set("stepState", {});
    },
    async showScreen(screenId, payload = {}) {
      await ws.send({
        name: "showScreen",
        data: { screenId, payload },
      });
    },
    async setActor(options) {
      if ("administrator" in options) {
        throw new Error("Setting administrator actor is not implemented yet");
      }

      const sessionId = c.get("wsSessionId");
      if (!sessionId) {
        throw new Error("No session ID found in context");
      }

      await prisma.checkinActor.create({
        data: {
          checkinSessions: {
            connect: { id: sessionId },
          },
          participantId: options.participantId,
        },
      });
    },
    async overrideSession(newSessionId) {
      c.set("wsSessionId", newSessionId);
    },
  };
}
