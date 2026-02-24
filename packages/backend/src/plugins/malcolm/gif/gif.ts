import type { StepImplementation } from "../../../core/workflow/stepImplementation.ts";
import { typedMethod } from "../../../plugin-utils/implementation.ts";

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
