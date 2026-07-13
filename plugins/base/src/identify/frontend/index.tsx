import type { FrontendPluginContext } from "@scouterna/scoutin-plugin-api/frontend";
import { BlockedScreen } from "./screens/BlockedScreen";
import { PreviewActorScreen } from "./screens/PreviewActorScreen";
import { SelectActorScreen } from "./screens/SelectActorScreen";
import { StartScreen } from "./screens/StartScreen";

export const setup = (ctx: FrontendPluginContext) => {
  ctx.registerScreen({
    name: "base:identify:start",
    component: StartScreen,
  });

  // Shown by the identify step's native blocklist gate (see backend
  // identify.ts). Lives here because identify is the only thing that shows it.
  ctx.registerScreen({
    name: "base:blocklist:blocked",
    component: BlockedScreen,
  });

  ctx.registerScreen({
    name: "base:identify:previewActor",
    component: PreviewActorScreen,
  });

  ctx.registerScreen({
    name: "base:identify:selectActor",
    component: SelectActorScreen,
  });
};
