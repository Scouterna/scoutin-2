import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import type { Listeners, MessageTypes } from "@scouterna/scoutin-backend";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import { createAdminSession } from "@/api/session";
import type { TypedSocket } from "@/api/typedSocket";
import { ScreenRenderer } from "@/screens/ScreenRenderer";
import { SocketLoader } from "@/socket/SocketLoader";
import {
  currentScreenAtom,
  pendingAutoRestartAtom,
  screenHistoryAtom,
  sessionCredentialsAtom,
  sessionInfoAtom,
} from "@/store/session";
import { socketAtom } from "@/store/socket";
import { StaffInfoPanel } from "./StaffInfoPanel";

async function loadKioskStyles() {
  // The flow area renders the same @scouterna/ui-react kiosk screens the
  // physical kiosk does - lazy-load the same stylesheet, same pattern as
  // routes/_kiosk.tsx.
  await import("../../kiosk-styles.css");
}

export function StaffCheckin() {
  const [stylesLoaded, setStylesLoaded] = useState(false);
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [sessionEnded, setSessionEnded] = useState(false);

  const setCredentials = useSetAtom(sessionCredentialsAtom);
  const socket = useAtomValue(socketAtom);
  const [screenHistory, setScreenHistory] = useAtom(screenHistoryAtom);
  const setCurrentScreen = useSetAtom(currentScreenAtom);
  const currentScreen = useAtomValue(currentScreenAtom);
  const pendingAutoRestart = useAtomValue(pendingAutoRestartAtom);
  const setPendingAutoRestart = useSetAtom(pendingAutoRestartAtom);
  const setSessionInfo = useSetAtom(sessionInfoAtom);

  useEffect(() => {
    loadKioskStyles().finally(() => setStylesLoaded(true));
  }, []);

  const startNewSession = useCallback(async () => {
    setStartError(null);
    setSessionEnded(false);
    // Reset any state left over from a previous session in this view before
    // the new socket connects. Clearing sessionId also un-mounts SocketLoader
    // (see render below) - it must only ever mount once credentials for the
    // *new* session are already in the atom, otherwise its "don't connect if
    // a socket already exists" guard sees the still-live old socket and
    // skips connecting the new one entirely.
    setSessionId(null);
    setCurrentScreen(null);
    setScreenHistory([]);
    setSessionInfo(null);
    try {
      const { id, token } = await createAdminSession();
      setCredentials({ id, token });
      setSessionEpoch((prev) => prev + 1);
      setSessionId(id);
    } catch (err) {
      setStartError(
        err instanceof Error ? err.message : "Kunde inte starta session",
      );
    }
  }, [setCredentials, setCurrentScreen, setScreenHistory, setSessionInfo]);

  // Guards against StrictMode's dev-only double-invoke of effects (mount ->
  // cleanup -> mount) - without it, the first mount creates a session, and
  // the immediate synthetic remount creates a second, orphaned one. Same
  // pattern as SocketLoader's own `loaded` ref.
  const hasStartedRef = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only run once on mount
  useEffect(() => {
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;
    startNewSession();
  }, []);

  // `session:completed` flips `pendingAutoRestartAtom`, which the kiosk's
  // StartContent normally consumes to auto-restart into a new session. This
  // view never mounts StartContent, so nothing else reacts to that flag -
  // treat it as "the flow finished, show the next-person control" instead,
  // and reset it so it doesn't leak into the next session here.
  useEffect(() => {
    if (pendingAutoRestart) {
      setSessionEnded(true);
      setPendingAutoRestart(false);
    }
  }, [pendingAutoRestart, setPendingAutoRestart]);

  // A session can also end via abort (e.g. idle or an explicit abort further
  // down the flow) without setting pendingAutoRestartAtom - watch
  // session:terminated directly for that case.
  useEffect(() => {
    if (!socket) return;
    const handleTerminated = () => setSessionEnded(true);
    socket.on("session:terminated", handleTerminated);
    return () => socket.off("session:terminated", handleTerminated);
  }, [socket]);

  const handleBackClick = useCallback(() => {
    if (screenHistory.length > 0) {
      const previous = screenHistory[screenHistory.length - 1];
      setScreenHistory((prev) => prev.slice(0, -1));
      setCurrentScreen(previous ?? null);
    } else {
      socket?.send({ name: "step:goBack" });
    }
  }, [screenHistory, setScreenHistory, setCurrentScreen, socket]);

  const handleNextPerson = useCallback(() => {
    startNewSession();
  }, [startNewSession]);

  // Leaving mid-flow (navigating to another admin page, or starting the next
  // person) abandons the session - abort it (no-op if it already
  // completed/aborted) right before SocketLoader closes the connection.
  const abortSessionOnClose = useCallback(
    (s: TypedSocket<Listeners, MessageTypes>) => {
      s.send({ name: "session:abort" });
    },
    [],
  );

  if (!stylesLoaded) return null;

  return (
    <Box sx={{ display: "flex", gap: 2 }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {startError && <Alert severity="error">{startError}</Alert>}

        <Box sx={{ display: "flex", alignItems: "center", mb: 1, gap: 1 }}>
          <Typography variant="h6" sx={{ flex: 1 }}>
            Incheckning
          </Typography>
          {currentScreen != null && !sessionEnded && (
            <Button size="small" onClick={handleBackClick}>
              Tillbaka
            </Button>
          )}
          <Button size="small" variant="outlined" onClick={startNewSession}>
            Ny incheckning
          </Button>
        </Box>

        <Box
          sx={{
            position: "relative",
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
            height: "calc(100vh - 10rem)",
            overflow: "hidden",
          }}
        >
          {sessionEnded ? (
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: 600,
                gap: 2,
              }}
            >
              <Typography variant="h6">Incheckning klar</Typography>
              <Button variant="contained" onClick={handleNextPerson}>
                Nästa person
              </Button>
            </Box>
          ) : (
            sessionId && (
              <SocketLoader
                key={sessionEpoch}
                onBeforeClose={abortSessionOnClose}
              >
                <Box sx={{ p: 2, height: "100%" }}>
                  <ScreenRenderer />
                </Box>
              </SocketLoader>
            )
          )}
        </Box>
      </Box>

      <Divider orientation="vertical" flexItem />

      <Box sx={{ width: 360 }}>
        {sessionId && <StaffInfoPanel sessionId={sessionId} />}
      </Box>
    </Box>
  );
}
