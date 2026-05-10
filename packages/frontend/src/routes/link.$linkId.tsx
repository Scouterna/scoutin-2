import { ScoutButton } from "@scouterna/ui-react";
import { createFileRoute } from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useState } from "react";
import { ScreenRenderer } from "../screens/ScreenRenderer";
import { LinkSocketLoader } from "../socket/LinkSocketLoader";
import {
  currentScreenAtom,
  screenHistoryAtom,
  sessionInfoAtom,
} from "../store/session";
import { socketAtom } from "../store/socket";

export const Route = createFileRoute("/link/$linkId")({
  component: RouteComponent,
});

async function loadStyles() {
  await import("../kiosk-styles.css");
}

function RouteComponent() {
  const { linkId } = Route.useParams();
  const [stylesLoaded, setStylesLoaded] = useState(false);
  const socket = useAtomValue(socketAtom);
  const [screenHistory, setScreenHistory] = useAtom(screenHistoryAtom);
  const setCurrentScreen = useSetAtom(currentScreenAtom);
  const sessionInfo = useAtomValue(sessionInfoAtom);

  useEffect(() => {
    loadStyles().finally(() => setStylesLoaded(true));
  }, []);

  const handleBack = useCallback(() => {
    setScreenHistory((prev) => {
      if (prev.length > 0) {
        setCurrentScreen(prev[prev.length - 1] ?? null);
        return prev.slice(0, -1);
      }
      socket?.send({ name: "step:goBack" });
      return prev;
    });
  }, [socket, setScreenHistory, setCurrentScreen]);

  if (!stylesLoaded) return null;

  return (
    <div className="flex flex-col h-full min-h-screen">
      <div className="flex items-center justify-between p-4 border-b border-gray-100">
        <div>
          {screenHistory.length > 0 && (
            <ScoutButton variant="text" onClick={handleBack}>
              Tillbaka
            </ScoutButton>
          )}
        </div>
        {sessionInfo?.actor && (
          <span className="text-sm text-gray-600">
            {sessionInfo.actor.firstName} {sessionInfo.actor.lastName}
          </span>
        )}
      </div>
      <div className="flex-1 p-6">
        <LinkSocketLoader linkId={linkId}>
          <ScreenRenderer />
        </LinkSocketLoader>
      </div>
    </div>
  );
}
