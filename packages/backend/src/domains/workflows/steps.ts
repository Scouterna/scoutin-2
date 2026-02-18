import { StepRegistry } from "../../core/workflow/stepRegistry.ts";
import { deduplicateSession } from "../../plugins/base/deduplicateSession/deduplicateSession.ts";
import { identify } from "../../plugins/base/identify/identify.ts";

export const stepRegistry = new StepRegistry();

stepRegistry.register(identify);
stepRegistry.register(deduplicateSession);
