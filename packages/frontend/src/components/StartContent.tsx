import { ScoutButton } from "@scouterna/ui-react";
import { useMutation } from "@tanstack/react-query";
import { useAtomValue, useSetAtom } from "jotai";
import { create } from "@/api/session";
import { sessionInfoAtom } from "@/store/session";
import { socketAtom } from "@/store/socket";

export function StartContent() {
  const setSessionInfo = useSetAtom(sessionInfoAtom);
  const socket = useAtomValue(socketAtom);

  const createSession = useMutation({
    mutationFn: create,
    onSuccess: (data) => {
      setSessionInfo({
        id: data.sessionId,
        token: data.token,
      });

      socket?.send({
        name: "auth:authenticate",
        data: { token: data.token },
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
