import {
  type PluginSocket,
  PluginSocketContext,
} from "@scouterna/scoutin-plugin-api";
import { useAtomValue } from "jotai";
import { findScreen } from "@/plugins/plugins";
import { currentScreenAtom } from "@/store/session";
import { socketAtom } from "@/store/socket";

export function ScreenRenderer() {
  const currentScreenInfo = useAtomValue(currentScreenAtom);
  const socket = useAtomValue(socketAtom);

  if (!currentScreenInfo) {
    return <div>No screen selected</div>;
  }

  const currentScreen = findScreen(currentScreenInfo.screenId);

  if (!currentScreen) {
    return (
      <div>
        Screen not found: <pre>{currentScreenInfo.screenId}</pre>
      </div>
    );
  }

  return (
    <PluginSocketContext.Provider value={socket as unknown as PluginSocket | null}>
      <currentScreen.component payload={currentScreenInfo.payload} />
    </PluginSocketContext.Provider>
  );
}
