import { ScoutButton } from "@scouterna/ui-react";
import { useAtomValue } from "jotai";
import { socketAtom } from "@/store/socket";

export function StartScreen() {
  const socket = useAtomValue(socketAtom);

  const onNextClick = () => {
    socket?.send({
      name: "step:callMethod",
      data: {
        name: "dummy",
        inputs: {},
      },
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <p>Identify Start Screen</p>
      <ScoutButton onScoutClick={onNextClick}>Next screen</ScoutButton>
    </div>
  );
}
