import plugins from "virtual:scoutin-plugins";
import { pluginSetupContext } from "./plugins";

export function loadPlugins() {
  for (const plugin of plugins) {
    plugin.setup(pluginSetupContext);
  }
}
