import type { StepImplementation } from "@scouterna/scoutin-plugin-api/backend";
import { typedMethod } from "@scouterna/scoutin-plugin-api/backend";

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
