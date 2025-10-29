import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "flowbite-react";
import { useAtom } from "jotai";
import * as session from "../api/session";
import { sessionInfoAtom } from "../store/session";

export const Route = createFileRoute("/")({
  component: App,
});

function App() {
  const [_sessionInfo, setSessionInfo] = useAtom(sessionInfoAtom);

  const createSession = useMutation({
    mutationFn: session.create,
    onSuccess: (data) => {
      setSessionInfo({
        id: data.sessionId,
        token: data.token,
      });
    },
  });

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
    </div>
  );
}
