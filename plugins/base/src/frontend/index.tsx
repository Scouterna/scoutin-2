import type { FrontendPlugin } from "@scouterna/scoutin-plugin-api/frontend";
import { setup as deduplicateSetup } from "./deduplicateSession/index.tsx";
import { setup as identifySetup } from "./identify/index.tsx";
import { setup as selectSubjectsSetup } from "./selectSubjects/index.tsx";

export const plugin: FrontendPlugin = {
  setup(ctx) {
    identifySetup(ctx);
    deduplicateSetup(ctx);
    selectSubjectsSetup(ctx);
  },
};
