import { ScoutButton } from "@scouterna/ui-react";
import { useAtomValue } from "jotai";
import { socketAtom } from "@/store/socket";

export function GifScreen() {
  const socket = useAtomValue(socketAtom);

  const handleContinue = () => {
    socket?.send({
      name: "step:callMethod",
      data: {
        name: "continue",
      },
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <img alt="cat" src="/cat.gif" />
      </div>

      <div className="flex gap-4 justify-end mt-2">
        <ScoutButton variant="primary" onClick={handleContinue}>
          Fortsätt
        </ScoutButton>
      </div>
    </div>
  );
}
