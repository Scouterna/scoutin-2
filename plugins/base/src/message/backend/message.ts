import type { StepImplementation } from "@scouterna/scoutin-plugin-api/backend";
import { type } from "arktype";

export const message: StepImplementation = {
  id: "base:message",
  inputs: type({
    "title?": "string",
    "message?": "string",
    // These may be authored as `{ sv, en }` in config; the flow engine
    // resolves them to plain strings for the session language before we see
    // them.
    "buttonText?": "string",
    "requireAcknowledgement?": "boolean",
    "acknowledgementText?": "string",
  }),
  hooks: {
    async onStepStart(ctx) {
      const {
        title,
        message,
        buttonText,
        requireAcknowledgement,
        acknowledgementText,
      } = ctx.getInputs() as {
        title?: string;
        message?: string;
        buttonText?: string;
        requireAcknowledgement?: boolean;
        acknowledgementText?: string;
      };
      const actor = await ctx.getActor();

      const interpolate = (s: string) =>
        s
          .replace("{actor.firstName}", actor?.participant.firstName ?? "")
          .replace("{actor.lastName}", actor?.participant.lastName ?? "");

      await ctx.showScreen("base:message:message", {
        title: title ? interpolate(String(title)) : undefined,
        message: message ? interpolate(String(message)) : undefined,
        buttonText,
        requireAcknowledgement,
        acknowledgementText,
      });
    },
  },
  publicMethods: {
    confirm: {
      async handler(ctx) {
        await ctx.setCompleted();
      },
    },
  },
};
