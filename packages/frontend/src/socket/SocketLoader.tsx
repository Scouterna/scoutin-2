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
import { createTypedSocket, type TypedSocket } from "@/api/typedSocket";
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

const createRawSocket = async (onSendFailure: (reason: string) => void) => {
  const ws = await openSessionSocket();
  return createTypedSocket<Listeners, MessageTypes>(ws, onSendFailure);
};

type Props = {
  children: ReactNode;
  // Called synchronously with the live socket right before SocketLoader
  // closes it on unmount (the socket is still OPEN at this point) - lets a
  // consumer send a final message (e.g. session:abort) without racing the
  // close. Not used by the kiosk's own usage of this component.
  onBeforeClose?: (socket: TypedSocket<Listeners, MessageTypes>) => void;
};

export function SocketLoader({ children, onBeforeClose }: Props) {
  const loaded = useRef(false);
  const reconnectAttempts = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopHeartbeat = useRef<(() => void) | null>(null);
  // Set to false only on true component unmount (see the dedicated effect
  // below) - guards handleDisconnect against reconnecting a socket that
  // nothing is displaying anymore, e.g. when the component that owns this
  // SocketLoader navigates away.
  const isMountedRef = useRef(true);

  const [socket, setSocket] = useAtom(socketAtom);
  const [socketError, setSocketError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);

  const credentials = useAtomValue(sessionCredentialsAtom);
  // Use a ref so the close-event callback always sees the latest value without
  // needing to re-register the listener on every credentials change.
  const credentialsRef = useRef(credentials);
  credentialsRef.current = credentials;

  // "Latest ref" pattern so the unmount-only effect below (which must use an
  // empty dependency array to only fire once, on true unmount) can still call
  // the current onBeforeClose without re-running on every render.
  const onBeforeCloseRef = useRef(onBeforeClose);
  onBeforeCloseRef.current = onBeforeClose;

  // Kept in sync so the unmount-only effect can reach the live socket without
  // depending on `socket` (which would make it re-run - and re-close! - on
  // every reconnect, not just true unmount).
  const socketRef = useRef<TypedSocket<Listeners, MessageTypes> | null>(null);
  useEffect(() => {
    socketRef.current = socket;
  }, [socket]);

  // Runs its cleanup exactly once, on true component unmount - not on every
  // reconnect (unlike the per-socket effect below, which intentionally
  // re-runs its cleanup on each reconnect but must not close anything).
  // Closing here, rather than leaving the socket for the browser/server to
  // eventually notice via heartbeat timeout, is what lets a consumer
  // (onBeforeClose) reliably send a final message first.
  // biome-ignore lint/correctness/useExhaustiveDependencies: must run its cleanup exactly once, on true unmount - setSocket is stable regardless
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      const s = socketRef.current;
      if (s) {
        onBeforeCloseRef.current?.(s);
        s.close();
      }
      // Clearing the atom (not just closing the connection) matters just as
      // much: the next SocketLoader mount's "don't connect if a socket
      // already exists" guard would otherwise see this now-closed-but-still-
      // truthy socket object and skip connecting a replacement.
      setSocket(null);
    };
  }, []);

  const connectAndStore = useCallback(async () => {
    // A dead connection may never deliver a native `close` event (e.g. the
    // network vanishes without a FIN/RST) — `close()` itself can't complete
    // its handshake in that case either. So reconnection must be triggered
    // directly from the heartbeat timeout or a failed send, not only from
    // `close`. This flag makes the triggers idempotent in case more than one
    // eventually fires.
    let disconnected = false;
    const handleDisconnect = (reason: string) => {
      // Nothing is displaying this connection anymore - let it die instead
      // of reconnecting (and, if unmount already closed it intentionally,
      // instead of logging a spurious "closed, reconnecting…" for our own
      // close call).
      if (!isMountedRef.current) return;
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

    // Sending while the socket isn't OPEN (e.g. a silent disconnect that
    // hasn't produced a `close` event yet) is otherwise invisible to the
    // operator — route it into the same reconnect path as heartbeat/close.
    const s = await createRawSocket(handleDisconnect);
    setupSocket(s);

    if (credentialsRef.current) {
      s.send({
        name: "auth:authenticate",
        data: { token: credentialsRef.current.token },
      });
    }

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
