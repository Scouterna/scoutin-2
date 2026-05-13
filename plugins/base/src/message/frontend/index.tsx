import type { FrontendPluginContext } from "@scouterna/scoutin-plugin-api/frontend";
import { MessageScreen } from "./screens/MessageScreen.tsx";

export const setup = (ctx: FrontendPluginContext) => {
  ctx.registerScreen({
    name: "base:message:message",
    component: MessageScreen,
  });
};
