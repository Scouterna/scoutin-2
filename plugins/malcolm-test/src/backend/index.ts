import type { BackendPlugin } from "@scouterna/scoutin-plugin-api/backend";
import { gif } from "./gif/gif.ts";
import { staticGroupTag } from "./staticGroupTag.ts";

export const plugin: BackendPlugin = {
  setup(ctx) {
    ctx.registerStep(gif);
    ctx.registerImportEnricher(staticGroupTag);
  },
};
