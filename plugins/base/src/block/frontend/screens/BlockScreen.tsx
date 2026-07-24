import {
  useTranslations,
  ValidationError,
} from "@scouterna/scoutin-plugin-api/frontend";
import { type } from "arktype";

const Payload = type({
  "title?": "string",
  "message?": "string",
});

const dict = {
  sv: { title: "Du kan tyvärr inte checka in" },
  en: { title: "Unfortunately you cannot check in" },
};

export function BlockScreen({ payload }: { payload: object }) {
  const t = useTranslations(dict);

  const validPayload = Payload(payload);
  if (validPayload instanceof type.errors) {
    return <ValidationError errors={validPayload} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-heading-base font-semibold">
          {validPayload.title ?? t("title")}
        </h1>
        {validPayload.message && (
          <p className="text-body-base">{validPayload.message}</p>
        )}
      </div>
    </div>
  );
}
