import {
  ScreenActions,
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
  "allowCancel?": "boolean",
  "details?": type({
    "title?": "string",
    rows: type({ label: "string", value: "string" }).array(),
  }).array(),
});

const dict = {
  sv: {
    title: "Välkommen!",
    acknowledgement: "Jag har läst och förstått informationen",
    continue: "Fortsätt",
    cancel: "Avbryt",
  },
  en: {
    title: "Welcome!",
    acknowledgement: "I have read and understood this information",
    continue: "Continue",
    cancel: "Cancel",
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
    // Fills the panel so the details, not the buttons, give way when the
    // screen is short: they scroll inside their own area.
    <div className="h-full flex flex-col gap-6 short:gap-4">
      <div>
        <h1 className="text-heading-base font-semibold">
          {validPayload.title ?? t("title")}
        </h1>
        {validPayload.message && (
          <p className="text-body-base">{validPayload.message}</p>
        )}
      </div>
      {validPayload.details && validPayload.details.length > 0 && (
        <div className="min-h-0 overflow-y-auto flex flex-col divide-y divide-blue-100 bg-blue-50 px-8 short:px-6">
          {validPayload.details.map((section, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: sections come in a fixed config order
            <section key={index} className="py-8 short:py-4">
              {section.title && (
                <h2 className="mb-4 short:mb-2 text-heading-xs font-semibold">
                  {section.title}
                </h2>
              )}
              <dl className="grid grid-cols-2 gap-x-8 gap-y-6 short:gap-y-3">
                {section.rows.map(({ label, value }) => (
                  <div key={label}>
                    <dt className="text-body-sm font-semibold uppercase tracking-wide text-blue-600">
                      {label}
                    </dt>
                    <dd className="text-body-xl short:text-body-lg">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}
      {requiresAcknowledgement && (
        <ScoutCheckbox
          checked={acknowledged}
          label={validPayload.acknowledgementText ?? t("acknowledgement")}
          onScoutChecked={(e) => setAcknowledged(e.detail.checked)}
        />
      )}
      <ScreenActions>
        {validPayload.allowCancel && (
          <ScoutButton
            variant="outlined"
            onScoutClick={() => socket?.send({ name: "session:abort" })}
          >
            {t("cancel")}
          </ScoutButton>
        )}
        <ScoutButton
          variant="primary"
          onScoutClick={confirm}
          disabled={!canConfirm}
        >
          {validPayload.buttonText ?? t("continue")}
        </ScoutButton>
      </ScreenActions>
    </div>
  );
}
