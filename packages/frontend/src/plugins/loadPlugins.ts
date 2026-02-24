import * as baseDeduplicateSession from "../plugins/base/deduplicateSession";
import * as baseIdentify from "../plugins/base/identify";
import * as malcolmGif from "../plugins/malcolm/gif";
import { pluginSetupContext } from "./plugins";

export function loadPlugins() {
  baseIdentify.setup(pluginSetupContext);
  baseDeduplicateSession.setup(pluginSetupContext);
  malcolmGif.setup(pluginSetupContext);
}
