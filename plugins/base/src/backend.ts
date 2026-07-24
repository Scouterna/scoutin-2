import type { BackendPlugin } from "@scouterna/scoutin-plugin-api/backend";
import { block } from "./block/backend/block.ts";
import { confirmReCheckin } from "./confirmReCheckin/backend/confirmReCheckin.ts";
import { deduplicateSession } from "./deduplicateSession/backend/deduplicateSession.ts";
import { filterSubjects } from "./filterSubjects/backend/filterSubjects.ts";
import { identify } from "./identify/backend/identify.ts";
import { markConfirmedCheckedIn } from "./markConfirmedCheckedIn/backend/markConfirmedCheckedIn.ts";
import { markPreliminaryCheckedIn } from "./markPreliminaryCheckedIn/backend/markPreliminaryCheckedIn.ts";
import { message } from "./message/backend/message.ts";
import { selectLanguage } from "./selectLanguage/backend/selectLanguage.ts";
import { selectSubjects } from "./selectSubjects/backend/selectSubjects.ts";
import { setActorAsSubject } from "./setActorAsSubject/backend/setActorAsSubject.ts";

export const plugin: BackendPlugin = {
  setup(ctx) {
    ctx.registerStep(selectLanguage);
    ctx.registerStep(block);
    ctx.registerStep(identify);
    ctx.registerStep(deduplicateSession);
    ctx.registerStep(setActorAsSubject);
    ctx.registerStep(confirmReCheckin);
    ctx.registerStep(selectSubjects);
    ctx.registerStep(filterSubjects);
    ctx.registerStep(markPreliminaryCheckedIn);
    ctx.registerStep(markConfirmedCheckedIn);
    ctx.registerStep(message);
  },
};
