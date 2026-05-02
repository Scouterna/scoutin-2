import {
  type PluginSocket,
  PluginSocketContext,
} from "@scouterna/scoutin-plugin-api/frontend";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { findScreen } from "@/plugins/plugins";

export const Route = createFileRoute("/kiosk-frame")({
  component: KioskFrame,
});

type ScreenData = { screenId: string; payload: object };

function KioskFrame() {
  const [stylesLoaded, setStylesLoaded] = useState(false);
  const [currentScreen, setCurrentScreen] = useState<ScreenData | null>(null);
  const handlersRef = useRef(new Map<string, Set<(payload: object) => void>>());

  useEffect(() => {
    import("../kiosk-styles.css").finally(() => {
      setStylesLoaded(true);
      // Signal to the parent that the frame is ready to receive messages.
      window.parent.postMessage({ type: "kiosk-frame:ready" }, "*");
    });
  }, []);

  const pluginSocket: PluginSocket = {
    send: (message) => {
      window.parent.postMessage({ type: "kiosk-out", message }, "*");
    },
    onMessage: (name, handler) => {
      const handlers = handlersRef.current;
      if (!handlers.has(name)) handlers.set(name, new Set());
      // biome-ignore lint/style/noNonNullAssertion: just set above
      handlers.get(name)!.add(handler);
      return () => handlers.get(name)?.delete(handler);
    },
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type !== "kiosk-in") return;
      const msg = event.data.message as { name: string; data?: unknown };

      if (msg.name === "step:showScreen") {
        const data = msg.data as ScreenData;
        setCurrentScreen(data);
      } else if (msg.name === "step:message") {
        const { name, payload } = msg.data as {
          name: string;
          payload: object;
        };
        handlersRef.current.get(name)?.forEach((h) => {
          h(payload);
        });
      } else if (
        msg.name === "step:started" ||
        msg.name === "session:terminated"
      ) {
        setCurrentScreen(null);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  if (!stylesLoaded) return null;
  if (!currentScreen) return null;

  const screen = findScreen(currentScreen.screenId);
  if (!screen) {
    return (
      <div style={{ padding: 16 }}>
        Unknown screen: <code>{currentScreen.screenId}</code>
      </div>
    );
  }

  return (
    <PluginSocketContext.Provider value={pluginSocket}>
      <screen.component payload={currentScreen.payload} />
    </PluginSocketContext.Provider>
  );
}
