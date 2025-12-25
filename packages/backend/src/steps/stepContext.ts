import type { MessageTypes } from "../socket/session/messageTypes.ts";
import type { TypedWSContext } from "../socket/socketRouter.ts";
import type { StepMethodContext } from "./stepImplementation.ts";

export function createStepContext(
  ws: TypedWSContext<MessageTypes>,
): StepMethodContext {
  return {
    async sendMessage(name, payload = {}) {
      await ws.send({
        name: "stepMessage",
        data: { name, payload },
      });
    },
    setCompleted() {
      throw new Error("Not implemented");
    },
    async showScreen(screenId) {
      await ws.send({
        name: "showScreen",
        data: { screenId },
      });
    },
  };
}
