import type { StepImplementation } from "@scouterna/scoutin-plugin-api/backend";
import { type } from "arktype";

export const block: StepImplementation = {
  id: "base:block",
  inputs: type({
    "title?": "string",
    "message?": "string",
  }),
  hooks: {
    async onStepStart(ctx) {
      const { title, message } = ctx.getInputs();
      await ctx.showScreen("base:block:block", { title, message });
    },
  },
};
