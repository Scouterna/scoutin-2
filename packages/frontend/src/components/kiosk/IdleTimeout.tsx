import { ScoutCard } from "@scouterna/ui-react";
import { useAtomValue, useSetAtom } from "jotai";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { idleCountdownAtom } from "@/store/idle";
import { currentScreenAtom, navigationAtom } from "@/store/session";
import { socketAtom } from "@/store/socket";
import { IDLE_COUNTDOWN_MS, startIdleTimer } from "./idleTimer";

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
  const navigation = useAtomValue(navigationAtom);
  const socket = useAtomValue(socketAtom);
  const [msRemaining, setMsRemaining] = useState<number | null>(null);
  // A touch dismisses the dialog instantly; only a timeout animates it out.
  const [dismissedByTouch, setDismissedByTouch] = useState(false);

  // Lets the screens behind the dialog know (see useIsIdle in the plugin API).
  const setIdleCountdown = useSetAtom(idleCountdownAtom);
  const countdownShowing = msRemaining !== null;
  useEffect(() => {
    setIdleCountdown(countdownShowing);
  }, [countdownShowing, setIdleCountdown]);

  // Ref so the activity/timer effect below doesn't need to restart every
  // time the socket instance changes (e.g. across a reconnect).
  const socketRef = useRef(socket);
  socketRef.current = socket;

  // A locked step is waiting on something outside the kiosk (for example a
  // print), so it must not time the kiosk out.
  const timerActive = currentScreen != null && !navigation.locked;

  useEffect(() => {
    if (!timerActive) {
      setMsRemaining(null);
      return;
    }

    const { reset, stop } = startIdleTimer({
      onCountdownStart: () => {},
      onCountdownTick: (ms) => {
        setDismissedByTouch(false);
        setMsRemaining(ms);
      },
      onCountdownCancel: () => {
        setDismissedByTouch(true);
        setMsRemaining(null);
      },
      onAbort: () => {
        setDismissedByTouch(false);
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
  }, [timerActive]);

  // Kept while the dialog fades out, when msRemaining is already null.
  const lastSeconds = useRef(0);
  if (msRemaining !== null) lastSeconds.current = Math.ceil(msRemaining / 1000);
  const secondsRemaining = lastSeconds.current;

  return (
    // `custom` reaches the dialog as it leaves, so its exit can depend on why.
    <AnimatePresence custom={dismissedByTouch}>
      {msRemaining !== null && (
        <motion.div
          className="absolute top-0 left-0 w-full h-full flex items-center justify-center bg-black/40 z-40"
          custom={dismissedByTouch}
          initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
          animate={{ opacity: 1, backdropFilter: "blur(8px)" }}
          exit="exit"
          variants={{
            exit: (instant: boolean) => ({
              opacity: 0,
              backdropFilter: "blur(0px)",
              transition: { duration: instant ? 0 : 0.4, ease: "easeOut" },
            }),
          }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        >
          {/* Rises slightly into place with a smooth ease-in-out; leaves the
              same way, a little quicker. */}
          <motion.div
            className="w-2xl"
            initial={{ scale: 0.9, y: 16 }}
            animate={{
              scale: 1,
              y: 0,
              transition: { duration: 0.6, ease: [0.65, 0, 0.35, 1] },
            }}
            custom={dismissedByTouch}
            exit="exit"
            variants={{
              exit: (instant: boolean) => ({
                scale: 0.9,
                y: 16,
                transition: {
                  duration: instant ? 0 : 0.4,
                  ease: [0.65, 0, 0.35, 1],
                },
              }),
            }}
          >
            <ScoutCard>
              <div className="p-4 text-center">
                <h2 className="text-heading-lg font-semibold leading-tight mb-2">
                  Är du fortfarande där?
                </h2>
                {/* The countdown is separate from the text and has a fixed
                    width, so nothing moves as it ticks. */}
                <div className="relative mx-auto my-4 size-32">
                  {/* Empties smoothly over the whole countdown. The dialog
                      mounts when the countdown starts, so the animation
                      starts with it. */}
                  <svg
                    viewBox="0 0 100 100"
                    className="absolute inset-0 -rotate-90"
                    aria-hidden="true"
                  >
                    <circle
                      cx="50"
                      cy="50"
                      r="45"
                      fill="none"
                      strokeWidth="6"
                      className="stroke-blue-100"
                    />
                    <circle
                      cx="50"
                      cy="50"
                      r="45"
                      fill="none"
                      strokeWidth="6"
                      strokeLinecap="round"
                      pathLength={100}
                      strokeDasharray="100"
                      className="stroke-blue-700"
                      style={{
                        animation: `countdown-ring ${IDLE_COUNTDOWN_MS}ms linear forwards`,
                      }}
                    />
                  </svg>
                  <p className="absolute inset-0 flex items-center justify-center text-heading-xl font-semibold tabular-nums text-blue-700">
                    {secondsRemaining}
                  </p>
                </div>
                <p className="text-body-2xl">
                  Rör skärmen för att forsätta checka in
                </p>
              </div>
            </ScoutCard>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
