import type { StepImplementation } from "@scouterna/scoutin-plugin-api/backend";
import { type } from "arktype";
import { pickupStation } from "../station.ts";

export const pickupStationStep: StepImplementation = {
  id: "jamboree26:pickupStation",
  inputs: type({
    "participantType?": "unknown",
    "lastName?": "unknown",
    "delegateNumber?": "unknown",
    // These may be authored as `{ sv, en }` in config; the flow engine
    // resolves them to plain strings for the session language before we see
    // them.
    "title?": "string",
    "message?": "string",
    "buttonText?": "string",
  }),
  hooks: {
    async onStepStart(ctx) {
      const {
        participantType,
        lastName,
        delegateNumber,
        title,
        message,
        buttonText,
      } = ctx.getInputs() as {
        participantType?: unknown;
        lastName?: unknown;
        delegateNumber?: unknown;
        title?: string;
        message?: string;
        buttonText?: string;
      };

      await ctx.showScreen("jamboree26:pickupStation:show", {
        title,
        message,
        buttonText,
        station: pickupStation({ participantType, lastName, delegateNumber }),
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
