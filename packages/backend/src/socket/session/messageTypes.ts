import { type } from "arktype";
import {
  createMessageRegistry,
  type InferMessageTypes,
} from "../messageRegistry.ts";

export const messageTypes = createMessageRegistry()
  .register(
    "auth",
    type(
      {
        status: "'success'",
      },
      "|",
      {
        status: "'failure'",
        reason: "string",
      },
    ),
  )
  .register("heartbeat");

export type MessageTypes = InferMessageTypes<typeof messageTypes>;
