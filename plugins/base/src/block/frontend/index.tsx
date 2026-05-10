import type { FrontendPluginContext } from "@scouterna/scoutin-plugin-api/frontend";
import { BlockScreen } from "./screens/BlockScreen";

export const setup = (ctx: FrontendPluginContext) => {
  ctx.registerScreen({
    name: "base:block:block",
    component: BlockScreen,
  });
};
