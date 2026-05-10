import { ValidationError } from "@scouterna/scoutin-plugin-api/frontend";
import { type } from "arktype";

const Payload = type({
  "title?": "string",
  "message?": "string",
});

export function BlockScreen({ payload }: { payload: object }) {
  const validPayload = Payload(payload);
  if (validPayload instanceof type.errors) {
    return <ValidationError errors={validPayload} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-heading-base font-semibold">
          {validPayload.title ?? "Du kan tyvärr inte checka in"}
        </h1>
        {validPayload.message && (
          <p className="text-body-base">{validPayload.message}</p>
        )}
      </div>
    </div>
  );
}
