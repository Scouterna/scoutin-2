import type { StepImplementation } from "@scouterna/scoutin-plugin-api";
import { typedMethod } from "@scouterna/scoutin-plugin-api";

export const gif: StepImplementation = {
  id: "malcolm:gif",
  hooks: {
    async onStepStart(ctx) {
      await ctx.showScreen("malcolm:gif:gif");
    },
  },
  publicMethods: {
    continue: typedMethod({
      async handler(ctx) {
        await ctx.setCompleted();
      },
    }),
  },
};
