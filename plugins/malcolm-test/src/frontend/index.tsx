import type { FrontendPlugin } from "@scouterna/scoutin-plugin-api/frontend";
import { setup as gifSetup } from "./gif/index.tsx";

export const plugin: FrontendPlugin = {
  setup(ctx) {
    gifSetup(ctx);
  },
};
