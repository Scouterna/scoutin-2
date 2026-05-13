import {
  usePluginSocket,
  ValidationError,
} from "@scouterna/scoutin-plugin-api/frontend";
import { ScoutButton } from "@scouterna/ui-react";
import { type } from "arktype";

const Payload = type({
  "title?": "string",
  "message?": "string",
  "buttonText?": type({
    "sv?": "string",
    "en?": "string",
  }),
});

export function MessageScreen({ payload }: { payload: object }) {
  const socket = usePluginSocket();

  const validPayload = Payload(payload);
  if (validPayload instanceof type.errors) {
    return <ValidationError errors={validPayload} />;
  }

  const confirm = () => {
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
      <div>
        <ScoutButton variant="primary" onScoutClick={confirm}>
          {validPayload.buttonText?.sv ?? validPayload.buttonText?.en ?? "Fortsätt"}
        </ScoutButton>
      </div>
    </div>
  );
}
