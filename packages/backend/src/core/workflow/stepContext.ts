import { completeStep } from "../../domains/workflows/step.service.ts";
import type { MessageTypes } from "../websocket/messageTypes.ts";
import type { TypedWSContext } from "../websocket/socketRouter.ts";
import type { TypedContext } from "../websocket/types.ts";
import type {
  StepImplementation,
  StepMethodContext,
} from "./stepImplementation.ts";

export function createStepContext(
  c: TypedContext,
  ws: TypedWSContext<MessageTypes>,
  stepImplementation: StepImplementation,
): StepMethodContext {
  return {
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

      await completeStep(
        sessionId,
        stepImplementation.id,
        stepMeta.idInFlow,
        stepMeta.evaluatedInputs,
        validatedOutputs,
      );
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
  };
}
