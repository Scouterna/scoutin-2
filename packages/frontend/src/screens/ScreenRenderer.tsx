import {
  type PluginSocket,
  PluginSocketContext,
} from "@scouterna/scoutin-plugin-api";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { findScreen } from "@/plugins/plugins";
import { currentScreenAtom } from "@/store/session";
import { socketAtom } from "@/store/socket";

export function ScreenRenderer() {
  const currentScreenInfo = useAtomValue(currentScreenAtom);
  const socket = useAtomValue(socketAtom);

  const pluginSocket = useMemo<PluginSocket | null>(() => {
    if (!socket) return null;
    return {
      send: (message) => socket.send(message as Parameters<typeof socket.send>[0]),
      onMessage: (name: string, handler: (payload: object) => void) => {
        const listener = ({ name: msgName, payload }: { name: string; payload: object }) => {
          if (msgName === name) handler(payload);
        };
        socket.on("step:message", listener);
        return () => socket.off("step:message", listener);
      },
    };
  }, [socket]);

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
    <PluginSocketContext.Provider value={pluginSocket}>
      <currentScreen.component payload={currentScreenInfo.payload} />
    </PluginSocketContext.Provider>
  );
}
