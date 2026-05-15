import type { BackendPlugin } from "@scouterna/scoutin-plugin-api/backend";
import { checkLeaderRequirements } from "./checkLeaderRequirements/checkLeaderRequirements.ts";

export const plugin: BackendPlugin = {
  setup(ctx) {
    ctx.registerStep(checkLeaderRequirements);
  },
};
