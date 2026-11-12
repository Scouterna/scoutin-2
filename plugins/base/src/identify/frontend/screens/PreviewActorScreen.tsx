import {
  CtaButton,
  ScreenActions,
  usePluginSocket,
  useTranslations,
  ValidationError,
} from "@scouterna/scoutin-plugin-api/frontend";
import { ScoutButton } from "@scouterna/ui-react";
import { type } from "arktype";

const dict = {
  sv: {
    question: "Är det här du?",
    confirm: "Ja, det är jag",
    deny: "Nej, det är inte jag",
  },
  en: {
    question: "Is this you?",
    confirm: "Yes, that's me",
    deny: "No, that's not me",
  },
};

const Payload = type({
  candidate: {
    id: "string",
    firstName: "string",
    lastName: "string",
    previewFields: type({ label: "string", value: "string" }).array(),
  },
});

export function PreviewActorScreen({ payload }: { payload: object }) {
  const socket = usePluginSocket();
  const t = useTranslations(dict);

  const validPayload = Payload(payload);
  if (validPayload instanceof type.errors) {
    return <ValidationError errors={validPayload} />;
  }
  const { candidate } = validPayload;

  const callMethod = (name: string) =>
    socket?.send({ name: "step:callMethod", data: { name } });

  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="text-body-2xl">{t("question")}</p>
        <h1 className="text-heading-xl font-semibold text-blue-700">
          {candidate.firstName} {candidate.lastName}
        </h1>
      </div>

      {candidate.previewFields.length > 0 && (
        <dl className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-x-8 gap-y-6 bg-blue-50 p-8">
          {candidate.previewFields.map(({ label, value }) => (
            <div key={label}>
              <dt className="text-body-sm font-semibold uppercase tracking-wide text-blue-600">
                {label}
              </dt>
              <dd className="text-body-xl">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      <ScreenActions className="items-center justify-between gap-8">
        <ScoutButton
          variant="text"
          size="large"
          onScoutClick={() => callMethod("denyActor")}
        >
          {t("deny")}
        </ScoutButton>
        <CtaButton onClick={() => callMethod("confirmActor")}>
          {t("confirm")}
        </CtaButton>
      </ScreenActions>
    </div>
  );
}
