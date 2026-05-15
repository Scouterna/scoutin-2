import type { FrontendPluginContext } from "@scouterna/scoutin-plugin-api/frontend";
import { LeaderRequirementsWarningScreen } from "./screens/LeaderRequirementsWarningScreen";

export const setup = (ctx: FrontendPluginContext) => {
  ctx.registerScreen({
    name: "scoutnet:checkLeaderRequirements:warning",
    component: LeaderRequirementsWarningScreen,
  });
};
