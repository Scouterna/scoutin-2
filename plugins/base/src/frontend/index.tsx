import type { FrontendPlugin } from "@scouterna/scoutin-plugin-api";
import { setup as deduplicateSetup } from "./deduplicateSession/index.tsx";
import { setup as identifySetup } from "./identify/index.tsx";

export const plugin: FrontendPlugin = {
  setup(ctx) {
    identifySetup(ctx);
    deduplicateSetup(ctx);
  },
};
