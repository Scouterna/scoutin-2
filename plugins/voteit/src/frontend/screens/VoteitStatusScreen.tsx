import {
  usePluginSocket,
  useTranslations,
  ValidationError,
} from "@scouterna/scoutin-plugin-api/frontend";
import { ScoutButton, ScoutCallout, ScoutLoader } from "@scouterna/ui-react";
import { type } from "arktype";
import { useEffect, useRef, useState } from "react";

// The spinner shows at least this long, so a fast answer does not make it blink.
const MIN_WORKING_MS = 2000;

const Payload = type({ state: "'working'" })
  .or({
    state: "'granted'",
    result: "'granted' | 'alreadyGranted'",
  })
  .or({
    state: "'failed'",
    reason: "'notInvited' | 'ambiguous' | 'error'",
  });

const dict = {
  sv: {
    working: "Registrerar din rösträtt…",
    registered: "Din rösträtt är registrerad",
    continue: "Fortsätt",
    failedTitle: "Rösträtten kunde inte registreras",
    notInvited: "Vi hittade ingen inbjudan att rösta digitalt för dig.",
    unavailable: "Din rösträtt kunde inte registreras just nu.",
    help: "Gå till incheckningsdisken för hjälp. Du får ändå ett fysiskt röstkort.",
    retry: "Försök igen",
    skip: "Fortsätt utan digital röstning",
  },
  en: {
    working: "Registering your voting rights…",
    registered: "Your voting rights are registered",
    continue: "Continue",
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

  const continued = useRef(false);
  const minTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [minElapsed, setMinElapsed] = useState(false);

  const validPayload = Payload(payload);
  const isValid = !(validPayload instanceof type.errors);
  const isWorking = isValid && validPayload.state === "working";

  const call = (name: string) =>
    socket?.send({ name: "step:callMethod", data: { name } });

  const continueOnce = () => {
    if (continued.current) return;
    continued.current = true;
    call("continue");
  };

  // Runs on mount and whenever the spinner comes back (a retry): the screen
  // isn't remounted between payloads. The timer must survive the switch away
  // from working, so it is only cleared on unmount.
  useEffect(() => {
    if (!isWorking && minTimer.current !== undefined) return;
    setMinElapsed(false);
    clearTimeout(minTimer.current);
    minTimer.current = setTimeout(() => setMinElapsed(true), MIN_WORKING_MS);
  }, [isWorking]);
  useEffect(() => () => clearTimeout(minTimer.current), []);

  if (validPayload instanceof type.errors) {
    return <ValidationError errors={validPayload} />;
  }

  if (validPayload.state === "working" || !minElapsed) {
    return (
      <div className="flex flex-col gap-6 items-center">
        <h1 className="text-heading-base font-semibold">{t("working")}</h1>
        <ScoutLoader size="xl" />
      </div>
    );
  }

  if (validPayload.state === "granted") {
    return (
      <div className="flex flex-col gap-6">
        <ScoutCallout variant="success" heading={t("registered")} />
        <div className="flex justify-end">
          <ScoutButton variant="primary" onScoutClick={continueOnce}>
            {t("continue")}
          </ScoutButton>
        </div>
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
