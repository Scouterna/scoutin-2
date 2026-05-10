import { ScoutLoader } from "@scouterna/ui-react";
import { useAtom } from "jotai";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { openLinkSocket } from "../api/session";
import { socketAtom } from "../store/socket";
import { setupSocket } from "./socketLogic";

type Props = {
  linkId: string;
  children: ReactNode;
};

export function LinkSocketLoader({ linkId, children }: Props) {
  const loaded = useRef(false);
  const [socket, setSocket] = useAtom(socketAtom);
  const [error, setError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: setSocket should not be a dependency
  useEffect(() => {
    if (socket || loaded.current) return;
    loaded.current = true;

    openLinkSocket(linkId)
      .then((s) => {
        setupSocket(s);
        setSocket(s);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [linkId, socket]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <p className="text-red-600 text-center">{error}</p>
      </div>
    );
  }

  if (!socket) {
    return (
      <div className="flex items-center justify-center h-full">
        <ScoutLoader size="xl" />
      </div>
    );
  }

  return children;
}
