import { StepRegistry } from "../../core/workflow/stepRegistry.ts";
import { deduplicateSession } from "../../plugins/base/deduplicateSession/deduplicateSession.ts";
import { identify } from "../../plugins/base/identify/identify.ts";
import { setActorAsSubject } from "../../plugins/base/setActorAsSubject/setActorAsSubject.ts";
import { gif } from "../../plugins/malcolm/gif/gif.ts";

export const stepRegistry = new StepRegistry();

stepRegistry.register(identify);
stepRegistry.register(deduplicateSession);
stepRegistry.register(setActorAsSubject);
stepRegistry.register(gif);
