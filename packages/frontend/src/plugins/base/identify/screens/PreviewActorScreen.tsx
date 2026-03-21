import { ScoutButton } from "@scouterna/ui-react";
import { type } from "arktype";
import { useAtomValue } from "jotai";
import { ValidationError } from "@/components/kiosk/ValidationError";
import { socketAtom } from "@/store/socket";

const Payload = type({
  actor: {
    id: "string",
    firstName: "string",
    lastName: "string",
  },
});

export function PreviewActorScreen({ payload }: { payload: object }) {
  const socket = useAtomValue(socketAtom);

  const validPayload = Payload(payload);
  if (validPayload instanceof type.errors) {
    return <ValidationError errors={validPayload} />;
  }

  const handleConfirm = () => {
    socket?.send({
      name: "step:callMethod",
      data: {
        name: "confirmActor",
      },
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-heading-base">
          Hej {validPayload.actor.firstName}!
        </h1>
        <p className="text-body-base">Ser den här infon ut att stämma?</p>
      </div>

      <table className="w-full text-left">
        <tbody>
          {[
            ["Förnamn", validPayload.actor.firstName],
            ["Efternamn", validPayload.actor.lastName],
          ].map(([label, value]) => (
            <tr key={label}>
              <th className="font-medium w-0 pr-4">{label}:</th>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex gap-4 justify-end mt-2">
        <ScoutButton
          onScoutClick={() =>
            socket?.send({
              name: "step:callMethod",
              data: { name: "denyActor" },
            })
          }
        >
          Nej, det stämmer inte
        </ScoutButton>
        <ScoutButton variant="primary" onClick={handleConfirm}>
          Ja, det stämmer!
        </ScoutButton>
      </div>
    </div>
  );
}
