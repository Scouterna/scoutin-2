import type { FrontendPluginContext } from "@scouterna/scoutin-plugin-api/frontend";
import { SelectSubjectScreen } from "./screens/SelectSubjectScreen";

export const setup = (ctx: FrontendPluginContext) => {
  ctx.registerScreen({
    name: "base:selectSubjects:selectSubjects",
    component: SelectSubjectScreen,
  });
};
