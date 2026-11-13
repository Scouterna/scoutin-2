import type { FrontendPluginContext } from "@scouterna/scoutin-plugin-api/frontend";
import { PickupStationScreen } from "./screens/PickupStationScreen.tsx";

export const setup = (ctx: FrontendPluginContext) => {
  ctx.registerScreen({
    name: "jamboree26:pickupStation:show",
    component: PickupStationScreen,
  });
};
