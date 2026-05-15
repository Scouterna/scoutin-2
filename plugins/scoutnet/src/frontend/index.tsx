import type { FrontendPlugin } from "@scouterna/scoutin-plugin-api/frontend";
import { setup as checkLeaderRequirementsSetup } from "./checkLeaderRequirements/index.tsx";

export const plugin: FrontendPlugin = {
  setup(ctx) {
    checkLeaderRequirementsSetup(ctx);
  },
};
