import { ScoutButton, ScoutCard, ScoutLoader } from "@scouterna/ui-react";
import { useAtom } from "jotai";
import { useEffect, type ReactNode, useState } from "react";
import { socketAtom } from "../store/socket";
import { openSessionSocket } from "../api/session";
import { createTypedSocket } from "@/api/typedSocket";
import type { Listeners, MessageTypes } from "@scouterna/scoutin-backend";

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
          <pre className="bg-gray-100 p-2 rounded text-left whitespace-pre-wrap break-words">
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
  const [socket, setSocket] = useAtom(socketAtom);
  const [socketError, setSocketError] = useState<string | null>();

  useEffect(() => {
    if (socket) return;

    createSocket()
      .then((s) => {
        setSocket(s);
      })
      .catch((err) => {
        console.error("Failed to create WebSocket:", err);
        setSocketError(String(err));
      });
  }, [setSocket, socket]);

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
