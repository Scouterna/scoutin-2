import { ScoutButton } from "@scouterna/ui-react";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useAtom } from "jotai";
import { useCallback } from "react";
import { socketAtom } from "@/store/socket";
import * as session from "../api/session";
import { sessionInfoAtom } from "../store/session";

export const Route = createFileRoute("/test")({
  component: App,
});

function App() {
  const [sessionInfo, setSessionInfo] = useAtom(sessionInfoAtom);
  const [socket, _setSocket] = useAtom(socketAtom);

  const createSession = useMutation({
    mutationFn: session.create,
    onSuccess: (data) => {
      setSessionInfo({
        id: data.sessionId,
        token: data.token,
      });
    },
  });

  const authTest = useCallback(() => {
    if (!socket) {
      console.error("No WebSocket connection available");
      return;
    }
    if (!sessionInfo?.token) {
      console.error("No session token available for WebSocket connection");
      return;
    }

    socket.send({
      name: "auth:authenticate",
      data: {
        token: sessionInfo.token,
      },
    });
  }, [socket, sessionInfo]);

  const clearAuthTest = useCallback(() => {
    if (!socket) {
      console.error("No WebSocket connection available");
      return;
    }

    socket.send({
      name: "auth:clear",
    });
  }, [socket]);

  const socketTest = useCallback(() => {
    if (!socket) {
      console.error("No WebSocket connection available");
      return;
    }
    socket.send({
      name: "heartbeat",
    });
  }, [socket]);

  return (
    <div className="flex flex-col justify-center items-center gap-8 mt-48">
      <h1 className="text-heading-base">Välkommen till Jamboree26!</h1>
      {/* <pre className="overflow-x-auto max-w-screen">{sessionToken}</pre> */}
      <ScoutButton
        onScoutClick={() => {
          createSession.mutate();
        }}
        // disabled={createSession.isPending}
      >
        {createSession.isPending
          ? "Skapar session..."
          : "Checka in (skapa session)"}
      </ScoutButton>

      <ScoutButton
        onScoutClick={() => {
          authTest();
        }}
      >
        Authenticate WebSocket
      </ScoutButton>

      <ScoutButton
        onScoutClick={() => {
          clearAuthTest();
        }}
      >
        Clear authentication
      </ScoutButton>

      <ScoutButton
        onScoutClick={() => {
          socketTest();
        }}
      >
        Test WebSocket
      </ScoutButton>
    </div>
  );
}
