import { type } from "arktype";
import type { StepImplementation } from "../stepImplementation.ts";

// const SearchByStringInputSchema = type({
//   query: type("string"),
// });

export const identify: StepImplementation = {
  outputs: type({
    dataSource: type("string"),
  }),
  hooks: {
    onStepStart(ctx) {
      ctx.showScreen("base:identify:start");
    },
  },
  // publicMethods: {
  //   searchByString: {
  //     inputs: SearchByStringInputSchema,
  //     async handler(_ctx, inputs: typeof SearchByStringInputSchema.infer) {
  //       console.log(inputs.query);
  //     },
  //   },
  // },
};
