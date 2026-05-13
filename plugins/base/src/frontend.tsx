import type { FrontendPlugin } from "@scouterna/scoutin-plugin-api/frontend";
import { setup as blockSetup } from "./block/frontend/index.tsx";
import { setup as deduplicateSetup } from "./deduplicateSession/frontend/index.tsx";
import { setup as identifySetup } from "./identify/frontend/index.tsx";
import { setup as messageSetup } from "./message/frontend/index.tsx";
import { setup as selectSubjectsSetup } from "./selectSubjects/frontend/index.tsx";

export const plugin: FrontendPlugin = {
  setup(ctx) {
    blockSetup(ctx);
    identifySetup(ctx);
    deduplicateSetup(ctx);
    selectSubjectsSetup(ctx);
    messageSetup(ctx);
  },
};
