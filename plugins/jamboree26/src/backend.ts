import type { BackendPlugin } from "@scouterna/scoutin-plugin-api/backend";
import { specialNeeds } from "./enrichers/specialNeeds.ts";
import { specialNeedsStep } from "./specialNeeds/backend/specialNeeds.ts";

export const plugin: BackendPlugin = {
  setup(ctx) {
    ctx.registerStep(specialNeedsStep);
    ctx.registerImportEnricher(specialNeeds);
  },
};
