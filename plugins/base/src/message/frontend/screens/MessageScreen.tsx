import {
  usePluginSocket,
  useTranslations,
  ValidationError,
} from "@scouterna/scoutin-plugin-api/frontend";
import { ScoutButton, ScoutCheckbox } from "@scouterna/ui-react";
import { type } from "arktype";
import { useState } from "react";

const Payload = type({
  "title?": "string",
  "message?": "string",
  // Localized `{ sv, en }` config text is collapsed to a plain string by the
  // backend before it reaches this screen.
  "buttonText?": "string",
  "requireAcknowledgement?": "boolean",
  "acknowledgementText?": "string",
});

const dict = {
  sv: {
    title: "Välkommen!",
    acknowledgement: "Jag har läst och förstått informationen",
    continue: "Fortsätt",
  },
  en: {
    title: "Welcome!",
    acknowledgement: "I have read and understood this information",
    continue: "Continue",
  },
};

export function MessageScreen({ payload }: { payload: object }) {
  const socket = usePluginSocket();
  const t = useTranslations(dict);
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
          {validPayload.title ?? t("title")}
        </h1>
        {validPayload.message && (
          <p className="text-body-base">{validPayload.message}</p>
        )}
      </div>
      {requiresAcknowledgement && (
        <ScoutCheckbox
          checked={acknowledged}
          label={validPayload.acknowledgementText ?? t("acknowledgement")}
          onScoutChecked={(e) => setAcknowledged(e.detail.checked)}
        />
      )}
      <div>
        <ScoutButton
          variant="primary"
          onScoutClick={confirm}
          disabled={!canConfirm}
        >
          {validPayload.buttonText ?? t("continue")}
        </ScoutButton>
      </div>
    </div>
  );
}
