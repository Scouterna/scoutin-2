import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "flowbite-react";
import { useAtom } from "jotai";
import * as session from "../api/session";
import { sessionInfoAtom } from "../store/session";
import { useCallback, useState } from "react";

export const Route = createFileRoute("/")({
  component: App,
});

function App() {
  const [sessionInfo, setSessionInfo] = useAtom(sessionInfoAtom);

  const createSession = useMutation({
    mutationFn: session.create,
    onSuccess: (data) => {
      setSessionInfo({
        id: data.sessionId,
        token: data.token,
      });
    },
  });

  const [socket, setSocket] = useState<WebSocket | null>(null);

  const createSocket = useCallback(() => {
    session
      .openSessionSocket()
      .then((ws) => {
        setSocket(ws);
      })
      .catch((err) => {
        console.error("Failed to open WebSocket:", err);
      });
  }, [sessionInfo]);

  const authTest = useCallback(() => {
    if (!socket) {
      console.error("No WebSocket connection available");
      return;
    }
    if (!sessionInfo?.token) {
      console.error("No session token available for WebSocket connection");
      return;
    }

    socket.send(
      JSON.stringify({
        name: "auth",
        token: sessionInfo.token,
      }),
    );
  }, [socket, sessionInfo]);

  const socketTest = useCallback(() => {
    if (!socket) {
      console.error("No WebSocket connection available");
      return;
    }
    socket.send(
      JSON.stringify({
        name: "heartbeat",
      }),
    );
  }, [socket]);

  return (
    <div className="flex flex-col justify-center items-center gap-8 mt-48">
      <h1 className="text-4xl font-bold">Välkommen till Jamboree26!</h1>
      {/* <pre className="overflow-x-auto max-w-screen">{sessionToken}</pre> */}
      <Button
        size="xl"
        onClick={() => {
          createSession.mutate();
        }}
        disabled={createSession.isPending}
      >
        {createSession.isPending ? "Skapar session..." : "Checka in"}
      </Button>

      <Button
        onClick={() => {
          createSocket();
        }}
      >
        Create WebSocket
      </Button>

      <Button
        onClick={() => {
          authTest();
        }}
      >
        Authenticate WebSocket
      </Button>

      <Button
        onClick={() => {
          socketTest();
        }}
      >
        Test WebSocket
      </Button>
    </div>
  );
}
