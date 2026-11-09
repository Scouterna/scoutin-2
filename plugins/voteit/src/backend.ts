import type { BackendPlugin } from "@scouterna/scoutin-plugin-api/backend";
import { checkConfig, grantVoterRoleStep } from "./backend/grantVoterRole.ts";

export const plugin: BackendPlugin = {
  onStartup: checkConfig,
  setup(ctx) {
    ctx.registerStep(grantVoterRoleStep);
  },
};
