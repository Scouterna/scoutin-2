import { usePluginSocket } from "@scouterna/scoutin-plugin-api";
import { ScoutButton } from "@scouterna/ui-react";

export function StartOverPromptScreen() {
  const socket = usePluginSocket();

  const handleStartOver = () => {
    socket?.send({
      name: "step:callMethod",
      data: {
        name: "startOver",
      },
    });
  };

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
        <h1 className="text-heading-base">Hej igen!</h1>
        <p className="text-body-base">
          Det verkar som att du påbörjat en incheckning tidigare. Vill du börja
          om från början eller fortsätta där du var?
        </p>
      </div>

      <div className="flex gap-4 justify-end mt-2">
        <ScoutButton variant="outlined" onClick={handleStartOver}>
          Börja om
        </ScoutButton>
        <ScoutButton variant="primary" onClick={handleContinue}>
          Fortsätt där jag var
        </ScoutButton>
      </div>
    </div>
  );
}
