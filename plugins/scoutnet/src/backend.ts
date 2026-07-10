import type { BackendPlugin } from "@scouterna/scoutin-plugin-api/backend";
import { complianceGate } from "./complianceGate/backend/complianceGate.ts";
import { criminalRecordExtract } from "./enrichers/criminalRecordExtract.ts";
import { safeFromHarm } from "./enrichers/safeFromHarm.ts";

export const plugin: BackendPlugin = {
  setup(ctx) {
    ctx.registerStep(complianceGate);
    ctx.registerImportEnricher(safeFromHarm);
    ctx.registerImportEnricher(criminalRecordExtract);
  },
};
