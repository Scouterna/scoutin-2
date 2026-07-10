import type { FrontendPlugin } from "@scouterna/scoutin-plugin-api/frontend";
import { setup as complianceGateSetup } from "./complianceGate/frontend/index.tsx";

export const plugin: FrontendPlugin = {
  setup(ctx) {
    complianceGateSetup(ctx);
  },
};
