import { ScoutButton } from "@scouterna/ui-react";
import { useMutation } from "@tanstack/react-query";
import { useAtomValue, useSetAtom } from "jotai";
import { create } from "@/api/session";
import { showErrorToast } from "@/lib/errors";
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
    onError: (error) => {
      console.error("Failed to create session:", error);
      showErrorToast(error, "Kunde inte starta en ny session");
    },
  });

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-heading-lg font-semibold text-blue-700 leading-tight">
        Välkommen till Jamboree26!
      </h1>

      <p className="text-body-2xl">
        Klicka på knappen för att checka in som kår eller funktionär.
      </p>

      <ScoutButton
        variant="primary"
        onScoutClick={() => {
          createSession.mutate();
        }}
      >
        {createSession.isPending ? "Skapar session..." : "Checka in"}
      </ScoutButton>
    </div>
  );
}
