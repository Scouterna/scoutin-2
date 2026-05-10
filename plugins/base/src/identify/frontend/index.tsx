import type { FrontendPluginContext } from "@scouterna/scoutin-plugin-api/frontend";
import { PreviewActorScreen } from "./screens/PreviewActorScreen";
import { SelectActorScreen } from "./screens/SelectActorScreen";
import { StartScreen } from "./screens/StartScreen";

export const setup = (ctx: FrontendPluginContext) => {
  ctx.registerScreen({
    name: "base:identify:start",
    component: StartScreen,
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
