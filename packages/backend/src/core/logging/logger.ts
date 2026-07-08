import pino from "pino";
import config from "../../config/config.ts";
import type { TypedContext } from "../websocket/types.ts";

export type Logger = pino.Logger;

export const logger: Logger = pino({
  level:
    config.LOG_LEVEL ?? (config.NODE_ENV === "production" ? "info" : "debug"),
  transport:
    config.NODE_ENV === "production" ? undefined : { target: "pino-pretty" },
});

export function getLogger(c: TypedContext): Logger {
  return c.get("logger") ?? logger;
}
