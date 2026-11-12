import {
  ScreenActions,
  usePluginSocket,
} from "@scouterna/scoutin-plugin-api/frontend";
import { ScoutButton } from "@scouterna/ui-react";

export function GifScreen() {
  const socket = usePluginSocket();

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

      <ScreenActions>
        <ScoutButton variant="primary" onClick={handleContinue}>
          Fortsätt
        </ScoutButton>
      </ScreenActions>
    </div>
  );
}
