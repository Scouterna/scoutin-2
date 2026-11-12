import { IdleContext } from "@scouterna/scoutin-plugin-api/frontend";
import { createFileRoute } from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback } from "react";
import { showBackButton } from "@/components/kiosk/backButton";
import { HeroLayout } from "@/components/kiosk/HeroLayout";
import { IdleTimeout } from "@/components/kiosk/IdleTimeout";
import { idleCountdownAtom } from "@/store/idle";
import {
  currentScreenAtom,
  navigationAtom,
  screenHistoryAtom,
} from "@/store/session";
import { socketAtom } from "@/store/socket";
import { StartContent } from "../../components/kiosk/StartContent";
import { ScreenRenderer } from "../../screens/ScreenRenderer";

export const Route = createFileRoute("/_kiosk/")({
  component: RouteComponent,
});

function RouteComponent() {
  const currentScreen = useAtomValue(currentScreenAtom);
  const [screenHistory, setScreenHistory] = useAtom(screenHistoryAtom);
  const setCurrentScreen = useSetAtom(currentScreenAtom);
  const socket = useAtomValue(socketAtom);
  const navigation = useAtomValue(navigationAtom);
  const idle = useAtomValue(idleCountdownAtom);

  const handleBackClick = useCallback(() => {
    if (screenHistory.length > 0) {
      const previous = screenHistory[screenHistory.length - 1];
      setScreenHistory((prev) => prev.slice(0, -1));
      setCurrentScreen(previous ?? null);
    } else {
      socket?.send({ name: "step:goBack" });
    }
  }, [screenHistory, setScreenHistory, setCurrentScreen, socket]);

  return (
    <>
      <HeroLayout
        heroContent={<StartContent />}
        progressed={currentScreen != null}
        showBackButton={
          currentScreen != null &&
          showBackButton({
            locked: navigation.locked,
            canGoBack: navigation.canGoBack,
            historyLength: screenHistory.length,
            staff: false,
          })
        }
        onBackClick={handleBackClick}
      >
        <IdleContext.Provider value={idle}>
          <ScreenRenderer />
        </IdleContext.Provider>
      </HeroLayout>
      <IdleTimeout />
    </>
  );
}
