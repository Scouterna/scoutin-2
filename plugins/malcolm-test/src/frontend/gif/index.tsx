import type { FrontendPluginContext } from "@scouterna/scoutin-plugin-api/frontend";
import { GifScreen } from "./screens/GifScreen";

export const setup = (ctx: FrontendPluginContext) => {
  ctx.registerScreen({
    name: "malcolm:gif:gif",
    component: GifScreen,
  });
};
