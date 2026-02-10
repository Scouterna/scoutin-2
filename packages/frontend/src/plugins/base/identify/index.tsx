import type { PluginSetupContext } from "../../plugins";
import { PreviewActorScreen } from "./screens/PreviewActorScreen";
import { StartScreen } from "./screens/StartScreen";

export const setup = (ctx: PluginSetupContext) => {
  ctx.registerScreen({
    name: "base:identify:start",
    component: StartScreen,
  });

  ctx.registerScreen({
    name: "base:identify:dummy",
    component: () => <div>Dummy Screen</div>,
  });

  ctx.registerScreen({
    name: "base:identify:previewActor",
    component: PreviewActorScreen,
  });
};
