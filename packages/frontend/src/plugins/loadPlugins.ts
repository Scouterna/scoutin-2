import * as baseIdentify from "../plugins/base/identify";
import { pluginSetupContext } from "./plugins";

export function loadPlugins() {
  baseIdentify.setup(pluginSetupContext);
}
