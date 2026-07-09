import { ScoutCard } from "@scouterna/ui-react";
import { useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { currentScreenAtom } from "@/store/session";
import { socketAtom } from "@/store/socket";
import { startIdleTimer } from "./idleTimer";

// Any interaction anywhere on the kiosk counts as activity — a user who's
// mid-typing (e.g. a personnummer) shouldn't get timed out just because
// nothing has been sent to the server yet.
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "touchstart"] as const;

/**
 * Warns the user with a cancellable countdown after a period of inactivity,
 * then actively aborts the session if the countdown elapses. Only runs
 * while a session is actually in progress (a screen is shown) — the idle
 * start screen already waits indefinitely and auto-restarts on its own.
 */
export function IdleTimeout() {
  const currentScreen = useAtomValue(currentScreenAtom);
  const socket = useAtomValue(socketAtom);
  const [msRemaining, setMsRemaining] = useState<number | null>(null);

  // Ref so the activity/timer effect below doesn't need to restart every
  // time the socket instance changes (e.g. across a reconnect).
  const socketRef = useRef(socket);
  socketRef.current = socket;

  const inSession = currentScreen != null;

  useEffect(() => {
    if (!inSession) {
      setMsRemaining(null);
      return;
    }

    const { reset, stop } = startIdleTimer({
      onCountdownStart: () => {},
      onCountdownTick: setMsRemaining,
      onCountdownCancel: () => setMsRemaining(null),
      onAbort: () => {
        setMsRemaining(null);
        socketRef.current?.send({ name: "session:abort" });
      },
    });

    const handleActivity = () => reset();
    for (const eventName of ACTIVITY_EVENTS) {
      window.addEventListener(eventName, handleActivity, { passive: true });
    }

    return () => {
      stop();
      for (const eventName of ACTIVITY_EVENTS) {
        window.removeEventListener(eventName, handleActivity);
      }
    };
  }, [inSession]);

  if (msRemaining === null) return null;

  const secondsRemaining = Math.ceil(msRemaining / 1000);

  return (
    <div className="absolute top-0 left-0 w-full h-full flex items-center justify-center bg-black/40 backdrop-blur-xs z-40">
      <div className="w-2xl">
        <ScoutCard>
          <div className="p-4 text-center">
            <h2 className="text-heading-lg font-semibold leading-tight mb-2">
              Är du fortfarande där?
            </h2>
            <p className="text-body-2xl">
              Sessionen avslutas automatiskt om {secondsRemaining}{" "}
              {secondsRemaining === 1 ? "sekund" : "sekunder"} om ingen rör
              skärmen.
            </p>
          </div>
        </ScoutCard>
      </div>
    </div>
  );
}
