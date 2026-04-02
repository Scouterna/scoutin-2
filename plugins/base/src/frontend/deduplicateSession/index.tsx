import type { FrontendPluginContext } from "@scouterna/scoutin-plugin-api";
import { StartOverPromptScreen } from "./screens/StartOverPromptScreen";

export const setup = (ctx: FrontendPluginContext) => {
  ctx.registerScreen({
    name: "base:deduplicateSession:startOverPrompt",
    component: StartOverPromptScreen,
  });
};
