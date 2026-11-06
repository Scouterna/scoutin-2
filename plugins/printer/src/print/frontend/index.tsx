import type { FrontendPluginContext } from "@scouterna/scoutin-plugin-api/frontend";
import { PrinterStatusScreen } from "./screens/PrinterStatusScreen";

export const setup = (ctx: FrontendPluginContext) => {
  ctx.registerScreen({
    name: "printer:status",
    component: PrinterStatusScreen,
  });
};
