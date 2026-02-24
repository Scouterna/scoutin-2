import type { PluginSetupContext } from "../../plugins";
import { GifScreen } from "./screens/GifScreen";

export const setup = (ctx: PluginSetupContext) => {
  ctx.registerScreen({
    name: "malcolm:gif:gif",
    component: GifScreen,
  });
};
