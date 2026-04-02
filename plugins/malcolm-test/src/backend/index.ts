import type { BackendPlugin } from "@scouterna/scoutin-plugin-api";
import { gif } from "./gif/gif.ts";

export const plugin: BackendPlugin = {
  setup(ctx) {
    ctx.registerStep(gif);
  },
};
