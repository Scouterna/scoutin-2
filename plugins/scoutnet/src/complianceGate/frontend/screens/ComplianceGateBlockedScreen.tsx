import {
  usePluginSocket,
  ValidationError,
} from "@scouterna/scoutin-plugin-api/frontend";
import { ScoutButton, ScoutCallout } from "@scouterna/ui-react";
import { type } from "arktype";
import { useState } from "react";

const Payload = type({
  safeFromHarmOk: "boolean",
  criminalRecordExtractOk: "boolean",
});

export function ComplianceGateBlockedScreen({ payload }: { payload: object }) {
  const socket = usePluginSocket();

  // Once bypass is sent the step advances; a second send would land on the
  // next step (which has no `bypass` method) and surface as a spurious error.
  // Guard the button so it can only fire once while this screen is shown.
  const [submitting, setSubmitting] = useState(false);

  const validPayload = Payload(payload);
  if (validPayload instanceof type.errors) {
    return <ValidationError errors={validPayload} />;
  }

  const { safeFromHarmOk, criminalRecordExtractOk } = validPayload;

  const handleAbort = () => {
    socket?.send({ name: "session:abort" });
  };

  const handleBypass = () => {
    if (submitting) return;
    if (
      window.confirm(
        "Är du säker på att du vill checka in personen ändå, trots att kraven inte är uppfyllda?",
      )
    ) {
      setSubmitting(true);
      socket?.send({ name: "step:callMethod", data: { name: "bypass" } });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-heading-base font-semibold">
          Kan inte checka in ännu
        </h1>
      </div>

      {!safeFromHarmOk && (
        <ScoutCallout
          variant="warning"
          heading="Trygga Möten saknas eller har gått ut"
        >
          Genomför Trygga Möten på plats. När det är klart kan du checka in
          igen.
        </ScoutCallout>
      )}

      {!criminalRecordExtractOk && (
        <ScoutCallout
          variant="warning"
          heading="Registerutdrag saknas eller har gått ut"
        >
          Se rutin för utdrag ur belastningsregistret. Uppdatera i Scoutnet när
          utdraget är klart, så kan du checka in igen.
        </ScoutCallout>
      )}

      <div className="flex gap-4">
        <ScoutButton variant="primary" onScoutClick={handleAbort}>
          Avbryt
        </ScoutButton>
        <ScoutButton
          variant="outlined"
          onScoutClick={handleBypass}
          disabled={submitting}
        >
          Fortsätt ändå
        </ScoutButton>
      </div>
    </div>
  );
}
