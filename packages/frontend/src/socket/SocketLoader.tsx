import type { Listeners, MessageTypes } from "@scouterna/scoutin-backend";
import { ScoutButton, ScoutCard, ScoutLoader } from "@scouterna/ui-react";
import { useAtom, useAtomValue } from "jotai";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createTypedSocket } from "@/api/typedSocket";
import { openSessionSocket } from "../api/session";
import { sessionCredentialsAtom } from "../store/session";
import { socketAtom } from "../store/socket";
import { startHeartbeat } from "./heartbeat";
import { MAX_RECONNECT_ATTEMPTS, reconnectDelay } from "./reconnect";
import { setupSocket } from "./socketLogic";

const Wrapper = ({ children }: { children: ReactNode }) => {
  return (
    <div className="absolute top-0 left-0 w-full h-full flex flex-col gap-4 items-center justify-center bg-white z-50">
      {children}
    </div>
  );
};

const ErrorInfo = ({ message }: { message: string }) => {
  return (
    <>
      <ScoutCard>
        <div className="p-4">
          <h2 className="text-xl font-bold mb-2">Fel vid anslutning</h2>
          <p className="mb-4">
            Ett fel uppstod när anslutningen till servern skulle upprättas:
          </p>
          <pre className="bg-gray-100 p-2 rounded text-left whitespace-pre-wrap wrap-break-word">
            {message}
          </pre>
        </div>
      </ScoutCard>

      <ScoutButton
        variant="primary"
        onClick={() => {
          window.location.reload();
        }}
      >
        Starta om
      </ScoutButton>
    </>
  );
};

const createRawSocket = async () => {
  const ws = await openSessionSocket();
  return createTypedSocket<Listeners, MessageTypes>(ws);
};

export function SocketLoader({ children }: { children: ReactNode }) {
  const loaded = useRef(false);
  const reconnectAttempts = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopHeartbeat = useRef<(() => void) | null>(null);

  const [socket, setSocket] = useAtom(socketAtom);
  const [socketError, setSocketError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);

  const credentials = useAtomValue(sessionCredentialsAtom);
  // Use a ref so the close-event callback always sees the latest value without
  // needing to re-register the listener on every credentials change.
  const credentialsRef = useRef(credentials);
  credentialsRef.current = credentials;

  const connectAndStore = useCallback(async () => {
    const s = await createRawSocket();
    setupSocket(s);

    if (credentialsRef.current) {
      s.send({
        name: "auth:authenticate",
        data: { token: credentialsRef.current.token },
      });
    }

    // A dead connection may never deliver a native `close` event (e.g. the
    // network vanishes without a FIN/RST) — `close()` itself can't complete
    // its handshake in that case either. So reconnection must be triggered
    // directly from the heartbeat timeout, not only from `close`. This flag
    // makes the two triggers idempotent in case both eventually fire.
    let disconnected = false;
    const handleDisconnect = (reason: string) => {
      if (disconnected) return;
      disconnected = true;
      console.warn(`${reason}, reconnecting…`);
      stopHeartbeat.current?.();
      setReconnecting(true);

      const attempt = () => {
        if (reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) {
          setSocketError(
            `Kunde inte återansluta efter ${MAX_RECONNECT_ATTEMPTS} försök.`,
          );
          setReconnecting(false);
          return;
        }

        const delay = reconnectDelay(reconnectAttempts.current);
        reconnectAttempts.current++;

        reconnectTimer.current = setTimeout(async () => {
          try {
            await connectAndStore();
            reconnectAttempts.current = 0;
            setReconnecting(false);
          } catch {
            attempt();
          }
        }, delay);
      };

      attempt();
    };

    stopHeartbeat.current = startHeartbeat(s, () => {
      handleDisconnect("WebSocket heartbeat timed out");
      s.close();
    });

    s.addEventListener("close", (event) => {
      const { code } = event as CloseEvent;
      handleDisconnect(`WebSocket closed (code ${code})`);
    });

    setSocket(s);
  }, [setSocket]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: connectAndStore and setSocket are stable
  useEffect(() => {
    if (socket || loaded.current) return;

    // Ensure we only try to load the socket once, even during strict mode re-renders
    loaded.current = true;

    connectAndStore().catch((err) => {
      console.error("Failed to create WebSocket:", err);

      let errorString = String(err);
      if (err instanceof Error) {
        errorString = `${err.name}: ${err.message}\n${err.stack}`;
      } else if (err instanceof Event && err.type === "error") {
        errorString = "WebSocket error";
      }

      setSocketError(errorString);
    });

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      stopHeartbeat.current?.();
    };
  }, [socket]);

  if (socketError) {
    return (
      <Wrapper>
        <ErrorInfo message={socketError} />
      </Wrapper>
    );
  }

  if (!socket) {
    return (
      <Wrapper>
        <ScoutLoader text="Startar..." size="xl" />
      </Wrapper>
    );
  }

  return (
    <>
      {children}
      {reconnecting && (
        <Wrapper>
          <ScoutLoader text="Återansluter..." size="xl" />
        </Wrapper>
      )}
    </>
  );
}
