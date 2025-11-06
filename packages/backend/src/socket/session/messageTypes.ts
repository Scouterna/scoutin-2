import { type } from "arktype";
import {
  createMessageRegistry,
  type InferMessageTypes,
} from "../messageRegistry.ts";

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
  .register("heartbeat");

export type MessageTypes = InferMessageTypes<typeof messageTypes>;
