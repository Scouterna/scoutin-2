import type { BackendPlugin } from "@scouterna/scoutin-plugin-api/backend";
import {
  checkTemplates,
  listenForPrintResults,
  printStep,
} from "./print/backend/print.ts";

export const plugin: BackendPlugin = {
  onStartup: checkTemplates,
  setup(ctx) {
    ctx.registerStep(printStep);
    listenForPrintResults();
  },
};
