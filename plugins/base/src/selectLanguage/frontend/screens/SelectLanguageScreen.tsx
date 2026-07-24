import {
  usePluginSocket,
  ValidationError,
} from "@scouterna/scoutin-plugin-api/frontend";
import { ScoutButton } from "@scouterna/ui-react";
import { type } from "arktype";

const Payload = type({
  languages: type({
    code: "string",
    label: "string",
  }).array(),
});

/**
 * Bilingual by design: this is shown before we know what language the user
 * reads, so both the heading and the option labels are language-neutral (each
 * language is named in itself) and nothing here goes through `useTranslations`.
 */
export function SelectLanguageScreen({ payload }: { payload: object }) {
  const socket = usePluginSocket();

  const validPayload = Payload(payload);
  if (validPayload instanceof type.errors) {
    return <ValidationError errors={validPayload} />;
  }

  const select = (language: string) => {
    socket?.send({
      name: "step:callMethod",
      data: { name: "select", inputs: { language } },
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-heading-base font-semibold">Välj språk</h1>
        <p className="text-body-base">Choose language</p>
      </div>

      <div className="flex flex-col gap-4">
        {validPayload.languages.map((language) => (
          <ScoutButton
            key={language.code}
            variant="primary"
            size="large"
            onScoutClick={() => select(language.code)}
          >
            {language.label}
          </ScoutButton>
        ))}
      </div>
    </div>
  );
}
