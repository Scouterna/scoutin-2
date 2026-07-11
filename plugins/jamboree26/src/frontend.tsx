import type { FrontendPlugin } from "@scouterna/scoutin-plugin-api/frontend";
import { setup as specialNeedsSetup } from "./specialNeeds/frontend/index.tsx";

export const plugin: FrontendPlugin = {
  setup(ctx) {
    specialNeedsSetup(ctx);
  },
};
