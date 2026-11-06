import type { FrontendPlugin } from "@scouterna/scoutin-plugin-api/frontend";
import { setup as printSetup } from "./print/frontend/index.tsx";

export const plugin: FrontendPlugin = {
  setup(ctx) {
    printSetup(ctx);
  },
};
