import type { FrontendPluginContext } from "@scouterna/scoutin-plugin-api/frontend";
import { RfidScreen } from "./screens/RfidScreen";

export const setup = (ctx: FrontendPluginContext) => {
  ctx.registerScreen({
    name: "jamboree26:rfid:scan",
    component: RfidScreen,
  });
};
