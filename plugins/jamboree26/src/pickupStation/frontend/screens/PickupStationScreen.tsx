import {
  ScreenActions,
  usePluginSocket,
  useTranslations,
  ValidationError,
} from "@scouterna/scoutin-plugin-api/frontend";
import { ScoutButton } from "@scouterna/ui-react";
import { type } from "arktype";

const Payload = type({
  "title?": "string",
  "message?": "string",
  "buttonText?": "string",
  // The pickup station's sign text, or null for the check-in desk.
  station: "string | null",
});

const dict = {
  sv: {
    title: "Klart!",
    lead: "Hämta din namnskylt vid disk",
    desk: "Leta upp en funktionär",
    deskHelp: "Personalen där hjälper dig.",
    ok: "OK",
  },
  en: {
    title: "Done!",
    lead: "Pick up your name badge at",
    desk: "Check-in desk",
    deskHelp: "The staff there will help you.",
    ok: "OK",
  },
};

export function PickupStationScreen({ payload }: { payload: object }) {
  const socket = usePluginSocket();
  const t = useTranslations(dict);

  const validPayload = Payload(payload);
  if (validPayload instanceof type.errors) {
    return <ValidationError errors={validPayload} />;
  }

  const confirm = () => {
    socket?.send({ name: "step:callMethod", data: { name: "confirm" } });
  };

  // The Swedish sign text is shown as is in both languages.
  const station = validPayload.station;

  return (
    <div className="flex flex-col gap-6 short:gap-4">
      <div>
        <h1 className="text-heading-base font-semibold">
          {validPayload.title ?? t("title")}
        </h1>
        <p className="text-body-base">
          {validPayload.message && `${validPayload.message} `}
          {t("lead")}
        </p>
      </div>
      {/* Card in the same style as the base:message details. */}
      <div className="bg-blue-50 px-8 py-12 short:px-6 short:py-8 text-center">
        <p className="text-heading-xl short:text-heading-lg font-bold text-balance wrap-break-word">
          {station ?? t("desk")}
        </p>
        {station === null && (
          <p className="mt-4 short:mt-2 text-body-lg short:text-body-base">
            {t("deskHelp")}
          </p>
        )}
      </div>
      <ScreenActions>
        <ScoutButton variant="primary" onScoutClick={confirm}>
          {validPayload.buttonText ?? t("ok")}
        </ScoutButton>
      </ScreenActions>
    </div>
  );
}
