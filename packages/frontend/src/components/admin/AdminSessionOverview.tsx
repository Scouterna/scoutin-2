import type { Listeners, MessageTypes } from "@scouterna/scoutin-backend";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { toast } from "sonner";
import { useCallback, useEffect, useRef, useState } from "react";
import { openAdminSessionSocket } from "@/api/session";
import type { TypedSocket } from "@/api/typedSocket";
import { AdminDebugPanel, type LogEntry } from "./AdminDebugPanel";

type ConnectionState = "idle" | "connecting" | "connected" | "error";
type CurrentScreen = { screenId: string; payload: object };

export function AdminSessionOverview({ sessionId }: { sessionId: string }) {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [socket, setSocket] = useState<TypedSocket<
    Listeners,
    MessageTypes
  > | null>(null);
  const [currentScreen, setCurrentScreen] = useState<CurrentScreen | null>(
    null,
  );
  const updateCurrentScreen = (screen: CurrentScreen | null) => {
    currentScreenRef.current = screen;
    setCurrentScreen(screen);
  };
  const [messageLog, setMessageLog] = useState<LogEntry[]>([]);
  const socketRef = useRef<TypedSocket<Listeners, MessageTypes> | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const currentScreenRef = useRef<CurrentScreen | null>(null);
  const intentionalClose = useRef(false);

  const appendLog = (entry: LogEntry) =>
    setMessageLog((prev) => [entry, ...prev.slice(0, 99)]);

  const postToFrame = useCallback((message: object) => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: "kiosk-in", message },
      "*",
    );
  }, []);

  const connect = async () => {
    setConnectionState("connecting");
    setError(null);
    try {
      const forward = (name: string, data?: unknown) => {
        postToFrame({ name, data });
      };

      // Handlers are registered inside the setup callback so they are in place
      // before the auth message is sent — the server may send step:showScreen
      // immediately after auth:status, before the await below resolves.
      const sock = await openAdminSessionSocket(sessionId, (s) => {
        s.on("step:showScreen", (data) => {
          updateCurrentScreen(data);
          appendLog({
            ts: new Date(),
            direction: "in",
            name: "step:showScreen",
            data,
          });
          forward("step:showScreen", data);
        });
        s.on("step:started", () => {
          appendLog({ ts: new Date(), direction: "in", name: "step:started" });
          forward("step:started");
        });
        s.on("step:message", (data) => {
          appendLog({
            ts: new Date(),
            direction: "in",
            name: "step:message",
            data,
          });
          forward("step:message", data);
        });
        s.on("session:terminated", () => {
          appendLog({
            ts: new Date(),
            direction: "in",
            name: "session:terminated",
          });
          updateCurrentScreen(null);
          forward("session:terminated");
        });
        s.on("heartbeat", () => {
          appendLog({ ts: new Date(), direction: "in", name: "heartbeat" });
        });
        s.on("error", (data) => {
          appendLog({
            ts: new Date(),
            direction: "in",
            name: "error",
            data,
          });
          toast.error(`Server error: ${data.message}`, { duration: 8000 });
        });
      });

      socketRef.current = sock;

      // Wrap send to log outgoing messages
      const originalSend = sock.send.bind(sock);
      sock.send = (msg) => {
        appendLog({
          ts: new Date(),
          direction: "out",
          name: msg.name,
          data: "data" in msg ? msg.data : undefined,
        });
        originalSend(msg);
      };

      sock.addEventListener("close", () => {
        if (!intentionalClose.current) {
          toast.error("WebSocket connection closed", { duration: Infinity });
        }
        intentionalClose.current = false;
        setConnectionState("idle");
        setSocket(null);
        updateCurrentScreen(null);
        socketRef.current = null;
      });

      setSocket(sock);
      setConnectionState("connected");
    } catch (err) {
      setConnectionState("error");
      setError(err instanceof Error ? err.message : "Failed to connect");
    }
  };

  const disconnect = () => {
    intentionalClose.current = true;
    socketRef.current?.close();
  };

  useEffect(() => {
    return () => {
      intentionalClose.current = true;
      socketRef.current?.close();
    };
  }, []);

  // Handle messages from the iframe.
  useEffect(() => {
    const handle = (event: MessageEvent) => {
      if (event.data?.type === "kiosk-frame:ready") {
        // Iframe React app is mounted and listening — replay current screen if any.
        const screen = currentScreenRef.current;
        if (screen) {
          iframeRef.current?.contentWindow?.postMessage(
            {
              type: "kiosk-in",
              message: { name: "step:showScreen", data: screen },
            },
            "*",
          );
        }
      } else if (event.data?.type === "kiosk-out") {
        socketRef.current?.send(event.data.message);
      }
    };
    window.addEventListener("message", handle);
    return () => window.removeEventListener("message", handle);
  }, []);

  return (
    <Box>
      {/* Toolbar */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
        <Typography variant="h6">Live session</Typography>
        <Box sx={{ flex: 1 }} />
        {connectionState === "idle" && (
          <Button variant="contained" onClick={connect}>
            Connect
          </Button>
        )}
        {connectionState === "connecting" && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <CircularProgress size={16} />
            <Typography variant="body2">Connecting…</Typography>
          </Box>
        )}
        {connectionState === "connected" && (
          <>
            <Chip label="Connected" color="success" size="small" />
            <Button variant="outlined" size="small" onClick={disconnect}>
              Disconnect
            </Button>
          </>
        )}
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {connectionState !== "connected" || !socket ? (
        <Typography variant="body2" color="text.secondary">
          Connect to view and interact with this session in real time.
        </Typography>
      ) : (
        <Box sx={{ display: "flex", gap: 2, height: "calc(100vh - 220px)" }}>
          {/* Left: kiosk screen in isolated iframe */}
          <Paper
            variant="outlined"
            sx={{
              flex: 1,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                px: 2,
                pt: 1.5,
                pb: 1,
                display: "block",
                borderBottom: 1,
                borderColor: "divider",
              }}
            >
              Kiosk screen — {currentScreen?.screenId ?? "no screen"}
            </Typography>
            <iframe
              ref={iframeRef}
              src="/kiosk-frame"
              title="Kiosk preview"
              style={{
                flex: 1,
                border: "none",
                width: "100%",
                padding: "1rem",
              }}
            />
          </Paper>

          <Divider orientation="vertical" flexItem />

          {/* Right: debug panel */}
          <Box sx={{ width: 360, overflow: "auto" }}>
            <AdminDebugPanel
              sessionId={sessionId}
              socket={socket}
              messageLog={messageLog}
              currentScreenId={currentScreen?.screenId ?? null}
            />
          </Box>
        </Box>
      )}
    </Box>
  );
}
