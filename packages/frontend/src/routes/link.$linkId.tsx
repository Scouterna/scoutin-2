import { ScoutButton, ScoutLoader } from "@scouterna/ui-react";
import { createFileRoute } from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import { authenticateSocket, prepareLinkSocket } from "../api/session";
import { LinkLandingContent } from "../components/link/LinkLandingContent";
import { ScreenRenderer } from "../screens/ScreenRenderer";
import { setupSocket } from "../socket/socketLogic";
import {
  currentScreenAtom,
  languageAtom,
  screenHistoryAtom,
  sessionInfoAtom,
} from "../store/session";
import { socketAtom } from "../store/socket";

export const Route = createFileRoute("/link/$linkId")({
  component: RouteComponent,
});

// The page chrome sits outside ScreenRenderer's LanguageContext, so it reads
// the session language straight from the atom.
const dict = {
  sv: { back: "Tillbaka", retry: "Försök igen" },
  en: { back: "Back", retry: "Try again" },
};

async function loadStyles() {
  await import("../kiosk-styles.css");
}

function RouteComponent() {
  const { linkId } = Route.useParams();
  const [stylesLoaded, setStylesLoaded] = useState(false);
  const [socket, setSocket] = useAtom(socketAtom);
  const [currentScreen, setCurrentScreen] = useAtom(currentScreenAtom);
  const setScreenHistory = useSetAtom(screenHistoryAtom);
  const sessionInfo = useAtomValue(sessionInfoAtom);
  const language = useAtomValue(languageAtom);
  const t = (key: keyof (typeof dict)["sv"]) => dict[language][key];
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const tokenRef = useRef<string | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    loadStyles().finally(() => setStylesLoaded(true));
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: setSocket should not be a dependency
  useEffect(() => {
    if (socket || loaded.current) return;
    loaded.current = true;

    prepareLinkSocket(linkId)
      .then(({ socket: s, token }) => {
        tokenRef.current = token;
        setupSocket(s);
        setSocket(s);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [linkId, socket]);

  const handleStart = useCallback(async () => {
    if (!socket || !tokenRef.current) return;
    setStarting(true);
    try {
      await authenticateSocket(socket, tokenRef.current);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }, [socket]);

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

  const renderContent = () => {
    if (error) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4">
          <p className="text-red-600 text-center">{error}</p>
          <ScoutButton
            variant="primary"
            onClick={() => window.location.reload()}
          >
            {t("retry")}
          </ScoutButton>
        </div>
      );
    }
    if (!socket) {
      return (
        <div className="flex items-center justify-center h-full">
          <ScoutLoader size="xl" />
        </div>
      );
    }
    if (currentScreen == null) {
      return <LinkLandingContent onStart={handleStart} starting={starting} />;
    }
    return <ScreenRenderer />;
  };

  return (
    <div className="flex flex-col h-full min-h-screen">
      <div className="flex items-center justify-between p-4 border-b border-gray-100">
        <div>
          {currentScreen != null && (
            <ScoutButton variant="text" onClick={handleBack}>
              {t("back")}
            </ScoutButton>
          )}
        </div>
        {sessionInfo?.actor && (
          <span className="text-sm text-gray-600">
            {sessionInfo.actor.firstName} {sessionInfo.actor.lastName}
          </span>
        )}
      </div>
      <div className="flex-1 p-6">{renderContent()}</div>
    </div>
  );
}
