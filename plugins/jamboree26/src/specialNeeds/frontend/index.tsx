import type { FrontendPluginContext } from "@scouterna/scoutin-plugin-api/frontend";
import { SpecialNeedsScreen } from "./screens/SpecialNeedsScreen";

export const setup = (ctx: FrontendPluginContext) => {
  ctx.registerScreen({
    name: "jamboree26:specialNeeds:info",
    component: SpecialNeedsScreen,
  });
};
