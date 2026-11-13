import type { BackendPlugin } from "@scouterna/scoutin-plugin-api/backend";
import { specialNeeds } from "./enrichers/specialNeeds.ts";
import { pickupStationStep } from "./pickupStation/backend/pickupStation.ts";
import { rfidStep } from "./rfid/backend/rfid.ts";
import { specialNeedsStep } from "./specialNeeds/backend/specialNeeds.ts";

export const plugin: BackendPlugin = {
  setup(ctx) {
    ctx.registerStep(specialNeedsStep);
    ctx.registerStep(rfidStep);
    ctx.registerStep(pickupStationStep);
    ctx.registerImportEnricher(specialNeeds);
  },
};
