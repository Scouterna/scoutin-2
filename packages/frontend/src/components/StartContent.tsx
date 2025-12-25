import { ScoutButton } from "@scouterna/ui-react";
import { useAtom } from "jotai";
import { sessionInfoAtom } from "@/store/session";
import { useMutation } from "@tanstack/react-query";
import { create } from "@/api/session";

export function StartContent() {
  const [sessionInfo, setSessionInfo] = useAtom(sessionInfoAtom);

  const createSession = useMutation({
    mutationFn: create,
    onSuccess: (data) => {
      setSessionInfo({
        id: data.sessionId,
        token: data.token,
      });
    },
  });

  return (
    <ScoutButton
      variant="primary"
      onScoutClick={() => {
        createSession.mutate();
      }}
    >
      {createSession.isPending ? "Skapar session..." : "Checka in"}
    </ScoutButton>
  );
}
