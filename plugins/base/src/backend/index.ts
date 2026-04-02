import type { BackendPlugin } from "@scouterna/scoutin-plugin-api";
import { deduplicateSession } from "./deduplicateSession/deduplicateSession.ts";
import { identify } from "./identify/identify.ts";
import { setActorAsSubject } from "./setActorAsSubject/setActorAsSubject.ts";

export const plugin: BackendPlugin = {
  setup(ctx) {
    ctx.registerStep(identify);
    ctx.registerStep(deduplicateSession);
    ctx.registerStep(setActorAsSubject);
  },
};
