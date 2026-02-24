import type { Listeners, MessageTypes } from "@scouterna/scoutin-backend";
import { ScoutButton, ScoutCard, ScoutLoader } from "@scouterna/ui-react";
import { useAtom } from "jotai";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createTypedSocket } from "@/api/typedSocket";
import { openSessionSocket } from "../api/session";
import { socketAtom } from "../store/socket";
import { setupSocket } from "./socketLogic";

const Wrapper = ({ children }: { children: ReactNode }) => {
  return (
    <div className="absolute top-0 left-0 w-full h-full flex flex-col gap-4 items-center justify-center bg-white">
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

const createSocket = async () => {
  const ws = await openSessionSocket();
  return createTypedSocket<Listeners, MessageTypes>(ws);
};

export function SocketLoader({ children }: { children: ReactNode }) {
  const loaded = useRef(false);

  const [socket, setSocket] = useAtom(socketAtom);
  const [socketError, setSocketError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: setSocket should not be a dependency
  useEffect(() => {
    if (socket || loaded.current) return;

    // Ensure we only try to load the socket once, even during strict mode re-renders
    loaded.current = true;

    createSocket()
      .then((s) => {
        setupSocket(s);
        setSocket(s);
      })
      .catch((err) => {
        console.error("Failed to create WebSocket:", err);

        let errorString = String(err);
        if (err instanceof Error) {
          errorString = `${err.name}: ${err.message}\n${err.stack}`;
        } else if (err instanceof Event && err.type === "error") {
          errorString = `WebSocket error`;
        }

        setSocketError(errorString);
      });
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

  return children;
}
