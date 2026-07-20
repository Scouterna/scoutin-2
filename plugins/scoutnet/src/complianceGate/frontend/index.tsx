import type { FrontendPluginContext } from "@scouterna/scoutin-plugin-api/frontend";
import { ComplianceGateBlockedScreen } from "./screens/ComplianceGateBlockedScreen";
import { ComplianceGateReportScreen } from "./screens/ComplianceGateReportScreen";

export const setup = (ctx: FrontendPluginContext) => {
  ctx.registerScreen({
    name: "scoutnet:complianceGate:blocked",
    component: ComplianceGateBlockedScreen,
  });
  ctx.registerScreen({
    name: "scoutnet:complianceGate:report",
    component: ComplianceGateReportScreen,
  });
};
