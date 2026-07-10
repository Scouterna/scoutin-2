import type { BackendPluginContext } from "@scouterna/scoutin-plugin-api/backend";
import pluginsJson from "../../../plugins.json" with { type: "json" };
import { EnricherRegistry } from "../../core/workflow/enricherRegistry.ts";
import { StepRegistry } from "../../core/workflow/stepRegistry.ts";

export const stepRegistry = new StepRegistry();
export const enricherRegistry = new EnricherRegistry();

const pluginContext: BackendPluginContext = {
  registerStep: (step) => stepRegistry.register(step),
  registerImportEnricher: (enricher) => enricherRegistry.register(enricher),
};

export async function loadPlugins() {
  for (const packageName of pluginsJson.plugins) {
    const { plugin } = await import(`${packageName}/backend`);
    plugin.setup(pluginContext);
  }
}
