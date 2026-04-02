import type { BackendPluginContext } from "@scouterna/scoutin-plugin-api";
import pluginsJson from "../../../plugins.json" with { type: "json" };
import { StepRegistry } from "../../core/workflow/stepRegistry.ts";

export const stepRegistry = new StepRegistry();

const pluginContext: BackendPluginContext = {
  registerStep: (step) => stepRegistry.register(step),
};

export async function loadPlugins() {
  for (const packageName of pluginsJson.plugins) {
    const { plugin } = await import(`${packageName}/backend`);
    plugin.setup(pluginContext);
  }
}
