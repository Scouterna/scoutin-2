import {
  usePluginSocket,
  ValidationError,
} from "@scouterna/scoutin-plugin-api/frontend";
import { ScoutButton, ScoutListView } from "@scouterna/ui-react";
import { type } from "arktype";

const Participant = type({
  id: "string",
  firstName: "string",
  lastName: "string",
  "subGroup?": "string | null",
});

const Payload = type({
  "title?": "string",
  "message?": "string",
  "buttonText?": type({
    "sv?": "string",
    "en?": "string",
  }),
  participants: Participant.array(),
});

// Mirrors list-view-item.css so display-only rows match a real ScoutListViewItem
// (which is always interactive - button/link/radio/checkbox - so it can't be
// reused here).
const rowStyle = {
  display: "flex",
  alignItems: "center",
  minHeight: "var(--spacing-12)",
  padding: "var(--spacing-4)",
  backgroundColor: "var(--color-white)",
  border: "1px solid var(--color-gray-100)",
  borderRadius: "6px",
  boxShadow: "0 1px 2px rgba(0, 22, 45, 0.04)",
} as const;

export function FilterSubjectsScreen({ payload }: { payload: object }) {
  const socket = usePluginSocket();

  const validPayload = Payload(payload);
  if (validPayload instanceof type.errors) {
    return <ValidationError errors={validPayload} />;
  }

  const confirm = () => {
    socket?.send({ name: "step:callMethod", data: { name: "confirm" } });
  };

  return (
    <div className="h-full flex flex-col gap-6">
      <div>
        <h1 className="text-heading-base font-semibold">
          {validPayload.title ?? "Information"}
        </h1>
        {validPayload.message && (
          <p className="text-body-base">{validPayload.message}</p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {validPayload.participants.length === 0 ? (
          <p className="text-body-base text-neutral-500">Inga matchande.</p>
        ) : (
          <ScoutListView>
            {validPayload.participants.map((participant) => (
              <div
                key={participant.id}
                className="text-body-base"
                style={rowStyle}
              >
                {participant.firstName} {participant.lastName}
              </div>
            ))}
          </ScoutListView>
        )}
      </div>

      <div className="flex justify-end">
        <ScoutButton variant="primary" onScoutClick={confirm}>
          {validPayload.buttonText?.sv ??
            validPayload.buttonText?.en ??
            "Fortsätt"}
        </ScoutButton>
      </div>
    </div>
  );
}
