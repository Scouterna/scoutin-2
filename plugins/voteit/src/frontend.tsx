import type { FrontendPlugin } from "@scouterna/scoutin-plugin-api/frontend";
import { VoteitStatusScreen } from "./frontend/screens/VoteitStatusScreen";

export const plugin: FrontendPlugin = {
  setup(ctx) {
    ctx.registerScreen({
      name: "voteit:status",
      component: VoteitStatusScreen,
    });
  },
};
