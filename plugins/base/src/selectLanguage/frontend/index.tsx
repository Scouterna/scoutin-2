import type { FrontendPluginContext } from "@scouterna/scoutin-plugin-api/frontend";
import { SelectLanguageScreen } from "./screens/SelectLanguageScreen.tsx";

export const setup = (ctx: FrontendPluginContext) => {
  ctx.registerScreen({
    name: "base:selectLanguage:select",
    component: SelectLanguageScreen,
  });
};
