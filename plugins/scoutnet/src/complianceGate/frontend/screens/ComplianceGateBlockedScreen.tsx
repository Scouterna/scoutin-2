import {
  usePluginSocket,
  ValidationError,
} from "@scouterna/scoutin-plugin-api/frontend";
import { ScoutButton, ScoutCallout } from "@scouterna/ui-react";
import { type } from "arktype";

const Payload = type({
  safeFromHarmOk: "boolean",
  criminalRecordExtractOk: "boolean",
});

export function ComplianceGateBlockedScreen({ payload }: { payload: object }) {
  const socket = usePluginSocket();

  const validPayload = Payload(payload);
  if (validPayload instanceof type.errors) {
    return <ValidationError errors={validPayload} />;
  }

  const { safeFromHarmOk, criminalRecordExtractOk } = validPayload;

  const handleAbort = () => {
    socket?.send({ name: "session:abort" });
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-heading-base font-semibold">
          Kan inte checka in ännu
        </h1>
      </div>

      {!safeFromHarmOk && (
        <ScoutCallout variant="warning" heading="Trygga Möten saknas">
          Genomför Trygga Möten på plats. När det är klart kan du checka in
          igen.
        </ScoutCallout>
      )}

      {!criminalRecordExtractOk && (
        <ScoutCallout variant="warning" heading="Registerutdrag saknas">
          Detta hanteras separat - se rutinerna för utdrag ur
          belastningsregistret (Truls dokument) innan incheckning kan slutföras.
        </ScoutCallout>
      )}

      <div>
        <ScoutButton variant="primary" onScoutClick={handleAbort}>
          Avbryt
        </ScoutButton>
      </div>
    </div>
  );
}
