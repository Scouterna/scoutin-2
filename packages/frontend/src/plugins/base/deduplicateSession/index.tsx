import type { PluginSetupContext } from "../../plugins";
import { StartOverPromptScreen } from "./screens/StartOverPromptScreen";

export const setup = (ctx: PluginSetupContext) => {
  ctx.registerScreen({
    name: "base:deduplicateSession:startOverPrompt",
    component: StartOverPromptScreen,
  });
};
