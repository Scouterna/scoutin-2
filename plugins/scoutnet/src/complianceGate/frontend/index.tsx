import type { FrontendPluginContext } from "@scouterna/scoutin-plugin-api/frontend";
import { ComplianceGateBlockedScreen } from "./screens/ComplianceGateBlockedScreen";

export const setup = (ctx: FrontendPluginContext) => {
  ctx.registerScreen({
    name: "scoutnet:complianceGate:blocked",
    component: ComplianceGateBlockedScreen,
  });
};
