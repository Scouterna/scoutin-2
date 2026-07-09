import { createFileRoute } from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback } from "react";
import { HeroLayout } from "@/components/kiosk/HeroLayout";
import { IdleTimeout } from "@/components/kiosk/IdleTimeout";
import { currentScreenAtom, screenHistoryAtom } from "@/store/session";
import { socketAtom } from "@/store/socket";
import heroVideoUrl from "../../../assets/hero_website.mp4";
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

  const handleBackClick = useCallback(() => {
    if (screenHistory.length > 0) {
      const previous = screenHistory[screenHistory.length - 1];
      setScreenHistory((prev) => prev.slice(0, -1));
      setCurrentScreen(previous ?? null);
    } else {
      socket?.send({ name: "step:goBack" });
    }
  }, [screenHistory, setScreenHistory, setCurrentScreen, socket]);

  const handleResetClick = useCallback(() => {
    socket?.send({ name: "session:abort" });
  }, [socket]);

  return (
    <>
      <HeroLayout
        heroContent={<StartContent />}
        progressed={currentScreen != null}
        showBackButton={currentScreen != null}
        onBackClick={handleBackClick}
        onResetClick={handleResetClick}
        backgroundVideoUrl={heroVideoUrl}
      >
        <ScreenRenderer />
      </HeroLayout>
      <IdleTimeout />
    </>
  );
}
