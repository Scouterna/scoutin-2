import type { FrontendPlugin } from "@scouterna/scoutin-plugin-api/frontend";
import { setup as blockSetup } from "./block/frontend/index.tsx";
import { setup as confirmReCheckinSetup } from "./confirmReCheckin/frontend/index.tsx";
import { setup as deduplicateSetup } from "./deduplicateSession/frontend/index.tsx";
import { setup as filterSubjectsSetup } from "./filterSubjects/frontend/index.tsx";
import { setup as identifySetup } from "./identify/frontend/index.tsx";
import { setup as messageSetup } from "./message/frontend/index.tsx";
import { setup as selectLanguageSetup } from "./selectLanguage/frontend/index.tsx";
import { setup as selectSubjectsSetup } from "./selectSubjects/frontend/index.tsx";

export const plugin: FrontendPlugin = {
  setup(ctx) {
    selectLanguageSetup(ctx);
    blockSetup(ctx);
    identifySetup(ctx);
    deduplicateSetup(ctx);
    confirmReCheckinSetup(ctx);
    selectSubjectsSetup(ctx);
    filterSubjectsSetup(ctx);
    messageSetup(ctx);
  },
};
