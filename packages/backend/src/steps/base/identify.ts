import { type } from "arktype";
import type { StepImplementation } from "../stepImplementation.ts";

const SearchByStringInputSchema = type({
  query: type("string"),
});

export const identify: StepImplementation = {
  id: "base:identify",
  outputs: type({
    dataSource: type("string"),
  }),
  hooks: {
    onStepStart(ctx) {
      ctx.showScreen("base:identify:start");
    },
  },
  publicMethods: {
    searchByString: {
      inputs: SearchByStringInputSchema,
      async handler(_ctx, inputs: typeof SearchByStringInputSchema.infer) {
        console.log(inputs.query);
      },
    },
    // dummy: {
    //   inputs: type({}),
    //   async handler(ctx, data) {
    //     // ctx.sendMessage("stepMessage", { info: "Dummy method called" });
    //     ctx.showScreen("base:identify:dummy");
    //   },
    // },
  },
};
