import {
  usePluginSocket,
  ValidationError,
} from "@scouterna/scoutin-plugin-api/frontend";
import { ScoutButton, ScoutCheckbox } from "@scouterna/ui-react";
import { type } from "arktype";
import { useState } from "react";

const Payload = type({
  "title?": "string",
  "message?": "string",
  "buttonText?": type({
    "sv?": "string",
    "en?": "string",
  }),
  "requireAcknowledgement?": "boolean",
  "acknowledgementText?": type({
    "sv?": "string",
    "en?": "string",
  }),
});

export function MessageScreen({ payload }: { payload: object }) {
  const socket = usePluginSocket();
  const [acknowledged, setAcknowledged] = useState(false);

  const validPayload = Payload(payload);
  if (validPayload instanceof type.errors) {
    return <ValidationError errors={validPayload} />;
  }

  const requiresAcknowledgement = validPayload.requireAcknowledgement === true;
  const canConfirm = !requiresAcknowledgement || acknowledged;

  const confirm = () => {
    if (!canConfirm) return;
    socket?.send({ name: "step:callMethod", data: { name: "confirm" } });
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-heading-base font-semibold">
          {validPayload.title ?? "Välkommen!"}
        </h1>
        {validPayload.message && (
          <p className="text-body-base">{validPayload.message}</p>
        )}
      </div>
      {requiresAcknowledgement && (
        <ScoutCheckbox
          checked={acknowledged}
          label={
            validPayload.acknowledgementText?.sv ??
            validPayload.acknowledgementText?.en ??
            "Jag har läst och förstått informationen"
          }
          onScoutChecked={(e) => setAcknowledged(e.detail.checked)}
        />
      )}
      <div>
        <ScoutButton
          variant="primary"
          onScoutClick={confirm}
          disabled={!canConfirm}
        >
          {validPayload.buttonText?.sv ??
            validPayload.buttonText?.en ??
            "Fortsätt"}
        </ScoutButton>
      </div>
    </div>
  );
}
