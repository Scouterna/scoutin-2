import type { FrontendPluginContext } from "@scouterna/scoutin-plugin-api/frontend";
import { StartOverPromptScreen } from "./screens/StartOverPromptScreen";

export const setup = (ctx: FrontendPluginContext) => {
  ctx.registerScreen({
    name: "base:deduplicateSession:startOverPrompt",
    component: StartOverPromptScreen,
  });
};
