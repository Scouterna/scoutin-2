import {
  usePluginSocket,
  useTranslations,
  ValidationError,
} from "@scouterna/scoutin-plugin-api/frontend";
import { ScoutButton, ScoutCallout, ScoutLoader } from "@scouterna/ui-react";
import { type } from "arktype";

const Payload = type({ state: "'working'" }).or({
  state: "'failed'",
  reason: "'notInvited' | 'ambiguous' | 'error'",
});

const dict = {
  sv: {
    working: "Registrerar din rösträtt…",
    failedTitle: "Rösträtten kunde inte registreras",
    notInvited: "Vi hittade ingen inbjudan att rösta digitalt för dig.",
    unavailable: "Din rösträtt kunde inte registreras just nu.",
    help: "Gå till incheckningsdisken för hjälp. Du får ändå ett fysiskt röstkort.",
    retry: "Försök igen",
    skip: "Fortsätt utan digital röstning",
  },
  en: {
    working: "Registering your voting rights…",
    failedTitle: "Your voting rights could not be registered",
    notInvited: "We could not find a voting invite for you.",
    unavailable: "Your voting rights could not be registered right now.",
    help: "Go to the check-in desk for help. You still get a physical voting card.",
    retry: "Try again",
    skip: "Continue without digital voting",
  },
};

export function VoteitStatusScreen({ payload }: { payload: object }) {
  const socket = usePluginSocket();
  const t = useTranslations(dict);

  const validPayload = Payload(payload);
  if (validPayload instanceof type.errors) {
    return <ValidationError errors={validPayload} />;
  }

  const call = (name: string) =>
    socket?.send({ name: "step:callMethod", data: { name } });

  if (validPayload.state === "working") {
    return (
      <div className="flex flex-col gap-6 items-center">
        <h1 className="text-heading-base font-semibold">{t("working")}</h1>
        <ScoutLoader size="xl" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <ScoutCallout variant="error" heading={t("failedTitle")}>
        <p>
          {validPayload.reason === "notInvited"
            ? t("notInvited")
            : t("unavailable")}
        </p>
        <p>{t("help")}</p>
      </ScoutCallout>

      <div className="flex justify-end gap-4">
        <ScoutButton variant="outlined" onScoutClick={() => call("skip")}>
          {t("skip")}
        </ScoutButton>
        <ScoutButton variant="primary" onScoutClick={() => call("retry")}>
          {t("retry")}
        </ScoutButton>
      </div>
    </div>
  );
}
