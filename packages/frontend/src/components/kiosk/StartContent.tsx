import { ScoutButton } from "@scouterna/ui-react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useAtomValue, useSetAtom } from "jotai";
import { create } from "@/api/session";
import { showErrorToast } from "@/lib/errors";
import { sessionCredentialsAtom } from "@/store/session";
import { socketAtom } from "@/store/socket";

export function StartContent() {
  const setSessionCredentials = useSetAtom(sessionCredentialsAtom);
  const socket = useAtomValue(socketAtom);
  const navigate = useNavigate();

  const createSession = useMutation({
    mutationFn: create,
    onSuccess: (data) => {
      setSessionCredentials({
        id: data.sessionId,
        token: data.token,
      });

      socket?.send({
        name: "auth:authenticate",
        data: { token: data.token },
      });
    },
    onError: (error) => {
      if (
        error &&
        typeof error === "object" &&
        "details" in error &&
        error.details &&
        typeof error.details === "object" &&
        "status" in error.details &&
        error.details.status === 401
      ) {
        localStorage.removeItem("kioskKey");
        navigate({ to: "/setup" });
        return;
      }
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
          if (!createSession.isPending) {
            createSession.mutate();
          }
        }}
      >
        Checka in
      </ScoutButton>
    </div>
  );
}
