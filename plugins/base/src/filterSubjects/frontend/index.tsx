import type { FrontendPluginContext } from "@scouterna/scoutin-plugin-api/frontend";
import { FilterSubjectsScreen } from "./screens/FilterSubjectsScreen.tsx";

export const setup = (ctx: FrontendPluginContext) => {
  ctx.registerScreen({
    name: "base:filterSubjects:filterSubjects",
    component: FilterSubjectsScreen,
  });
};
