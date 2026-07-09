import {
  usePluginSocket,
  ValidationError,
} from "@scouterna/scoutin-plugin-api/frontend";
import { ScoutButton } from "@scouterna/ui-react";
import { type } from "arktype";

const Payload = type({
  checkedInAt: "string",
});

export function ConfirmReCheckinScreen({ payload }: { payload: object }) {
  const socket = usePluginSocket();

  const validPayload = Payload(payload);
  if (validPayload instanceof type.errors) {
    return <ValidationError errors={validPayload} />;
  }

  const checkedInTime = new Date(validPayload.checkedInAt).toLocaleTimeString(
    "sv-SE",
    { hour: "2-digit", minute: "2-digit" },
  );

  const handleConfirm = () => {
    socket?.send({
      name: "step:callMethod",
      data: { name: "confirm" },
    });
  };

  const handleCancel = () => {
    socket?.send({ name: "session:abort" });
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-heading-base font-semibold">
          Du är redan incheckad!
        </h1>
        <p className="text-body-base">
          Du checkades in kl {checkedInTime}. Vill du checka in igen?
        </p>
      </div>

      <div className="flex gap-4 justify-end mt-2">
        <ScoutButton variant="outlined" onScoutClick={handleCancel}>
          Avbryt
        </ScoutButton>
        <ScoutButton variant="primary" onScoutClick={handleConfirm}>
          Ja, checka in igen
        </ScoutButton>
      </div>
    </div>
  );
}
