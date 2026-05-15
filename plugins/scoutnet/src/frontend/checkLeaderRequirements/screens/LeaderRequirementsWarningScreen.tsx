import { usePluginSocket } from "@scouterna/scoutin-plugin-api/frontend";
import { ScoutButton } from "@scouterna/ui-react";

export function LeaderRequirementsWarningScreen() {
  const socket = usePluginSocket();

  const handleConfirm = () => {
    socket?.send({ name: "step:callMethod", data: { name: "confirm" } });
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-heading-base font-semibold">
          Ledare uppfyller inte krav
        </h1>
        <p className="text-body-base">
          Följande ledare uppfyller inte vissa krav:
          <ul className="list-disc list-inside">
            <li>Annette Hittepå: Trygga möten</li>
            <li>
              Frans Finnsinte: Trygga möten, utdrag ut belastningsregistret
            </li>
          </ul>
          Samtliga ledare behöver uppfylla alla krav för att kunna delta.
        </p>
      </div>
      <div>
        <ScoutButton variant="primary" onClick={handleConfirm}>
          Fortsätt ändå
        </ScoutButton>
      </div>
    </div>
  );
}
