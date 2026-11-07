import type { BackendPlugin } from "@scouterna/scoutin-plugin-api/backend";
import { complianceGate } from "./complianceGate/backend/complianceGate.ts";
import { criminalRecordExtract } from "./enrichers/criminalRecordExtract.ts";
import { formAnswers } from "./enrichers/formAnswers.ts";
import { primaryGroup } from "./enrichers/primaryGroup.ts";
import { safeFromHarm } from "./enrichers/safeFromHarm.ts";

export const plugin: BackendPlugin = {
  setup(ctx) {
    ctx.registerStep(complianceGate);
    ctx.registerImportEnricher(safeFromHarm);
    ctx.registerImportEnricher(criminalRecordExtract);
    ctx.registerImportEnricher(formAnswers);
    ctx.registerImportEnricher(primaryGroup);
  },
};
