import type { MessageTypes } from "../websocket/messageTypes.ts";
import type { TypedWSContext } from "../websocket/socketRouter.ts";
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
    async showScreen(screenId, payload = {}) {
      await ws.send({
        name: "showScreen",
        data: { screenId, payload },
      });
    },
  };
}
