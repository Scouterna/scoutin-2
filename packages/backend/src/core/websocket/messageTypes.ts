import { type } from "arktype";
import { StepLayout } from "../../config/stepConfig.ts";
import {
  createMessageRegistry,
  type InferMessageTypes,
} from "./messageRegistry.ts";

export const messageTypes = createMessageRegistry()
  .register(
    "auth:status",
    type.or(
      {
        status: "'success'",
      },
      {
        status: "'failure'",
        reason: "string",
      },
      {
        status: "'cleared'",
      },
    ),
  )
  .register("heartbeat")
  .register(
    "step:message",
    type({
      name: "string",
      payload: "object",
    }),
  )
  .register(
    "step:showScreen",
    type({
      screenId: "string",
      payload: "object",
      "layout?": StepLayout,
    }),
  )
  .register("step:started")
  .register(
    "session:navigation",
    type({
      // A goBack would be allowed by barriers (independent of the lock).
      canGoBack: "boolean",
      locked: "boolean",
    }),
  )
  .register("session:terminated")
  .register("session:completed")
  .register(
    "session:info",
    type({
      "actor?": type({
        firstName: "string",
        lastName: "string",
        idInDataSource: "string",
      }).or("null"),
      // The session language, so the client can localize its own strings.
      "language?": "string",
    }),
  )
  .register(
    "error",
    type({
      code: "string",
      message: "string",
    }),
  );

export type MessageTypes = InferMessageTypes<typeof messageTypes>;
