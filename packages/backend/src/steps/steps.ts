import { identify } from "./base/identify.ts";
import { StepRegistry } from "./stepRegistry.ts";

export const stepRegistry = new StepRegistry();

stepRegistry.register(identify);
