import { StepRegistry } from "../../core/workflow/stepRegistry.ts";
import { identify } from "../../plugins/base/identify.ts";

export const stepRegistry = new StepRegistry();

stepRegistry.register(identify);
