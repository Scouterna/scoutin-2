import type { PluginSetupContext } from "../../plugins";
import { StartScreen } from "./StartScreen";

export const setup = (ctx: PluginSetupContext) => {
  ctx.registerScreen({
    name: "base:identify:start",
    component: () => <StartScreen />,
  });

  ctx.registerScreen({
    name: "base:identify:dummy",
    component: () => <div>Dummy Screen</div>,
  });
};
