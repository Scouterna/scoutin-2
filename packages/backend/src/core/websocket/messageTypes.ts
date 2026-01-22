import { type } from "arktype";
import {
  createMessageRegistry,
  type InferMessageTypes,
} from "./messageRegistry.ts";

export const messageTypes = createMessageRegistry()
  .register(
    "auth",
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
    "stepMessage",
    type({
      name: "string",
      payload: "object",
    }),
  )
  .register(
    "showScreen",
    type({
      screenId: "string",
      payload: "object",
    }),
  );

export type MessageTypes = InferMessageTypes<typeof messageTypes>;
