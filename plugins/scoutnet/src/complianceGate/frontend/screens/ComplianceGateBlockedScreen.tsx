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
  // Whether a failure blocks the flow. Defaults to true (the classic staff
  // gate: abort/bypass). When false, the screen is informational and offers a
  // single "continue" button instead.
  "block?": "boolean",
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

  const {
    safeFromHarmOk,
    criminalRecordExtractOk,
    block = true,
  } = validPayload;

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

  const handleContinue = () => {
    if (submitting) return;
    setSubmitting(true);
    socket?.send({ name: "step:callMethod", data: { name: "confirm" } });
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-heading-base font-semibold">
          {block ? "Kan inte checka in ännu" : "Obs – krav saknas"}
        </h1>
      </div>

      {!safeFromHarmOk && (
        <ScoutCallout
          variant="warning"
          heading="Trygga Möten saknas eller har gått ut"
        >
          {block
            ? "Genomför Trygga Möten på plats. När det är klart kan du checka in igen."
            : "Genomför Trygga Möten så snart som möjligt."}
        </ScoutCallout>
      )}

      {!criminalRecordExtractOk && (
        <ScoutCallout
          variant="warning"
          heading="Registerutdrag saknas eller har gått ut"
        >
          {block
            ? "Se rutin för utdrag ur belastningsregistret. Uppdatera i Scoutnet när utdraget är klart, så kan du checka in igen."
            : "Se rutin för utdrag ur belastningsregistret och uppdatera i Scoutnet."}
        </ScoutCallout>
      )}

      {block ? (
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
      ) : (
        <div className="flex justify-end">
          <ScoutButton
            variant="primary"
            onScoutClick={handleContinue}
            disabled={submitting}
          >
            Fortsätt
          </ScoutButton>
        </div>
      )}
    </div>
  );
}
