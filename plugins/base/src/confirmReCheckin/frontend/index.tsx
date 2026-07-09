import type { FrontendPluginContext } from "@scouterna/scoutin-plugin-api/frontend";
import { ConfirmReCheckinScreen } from "./screens/ConfirmReCheckinScreen";

export const setup = (ctx: FrontendPluginContext) => {
  ctx.registerScreen({
    name: "base:confirmReCheckin:confirm",
    component: ConfirmReCheckinScreen,
  });
};
