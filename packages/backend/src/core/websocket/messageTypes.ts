import { type } from "arktype";
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
    }),
  )
  .register("step:started")
  .register("session:terminated");

export type MessageTypes = InferMessageTypes<typeof messageTypes>;
