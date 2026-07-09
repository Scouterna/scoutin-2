import type { StepImplementation } from "@scouterna/scoutin-plugin-api/backend";
import { type } from "arktype";

export const message: StepImplementation = {
  id: "base:message",
  inputs: type({
    "title?": "string",
    "message?": "string",
    "buttonText?": type({
      "sv?": "string",
      "en?": "string",
    }),
    "requireAcknowledgement?": "boolean",
    "acknowledgementText?": type({
      "sv?": "string",
      "en?": "string",
    }),
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
        buttonText?: { sv?: string; en?: string };
        requireAcknowledgement?: boolean;
        acknowledgementText?: { sv?: string; en?: string };
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
