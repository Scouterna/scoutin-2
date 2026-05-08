import {
  usePluginSocket,
  ValidationError,
} from "@scouterna/scoutin-plugin-api/frontend";
import {
  ScoutButton,
  ScoutListView,
  ScoutListViewItem,
} from "@scouterna/ui-react";
import { type } from "arktype";
import { Fragment, useState } from "react";

const Participant = type({
  id: "string",
  firstName: "string",
  lastName: "string",
});
// type Participant = typeof Participant.infer;

const Payload = type({
  actorParticipantId: "string",
  participants: Participant.array(),
});

export function SelectSubjectScreen({ payload }: { payload: object }) {
  const socket = usePluginSocket();

  const validPayload = Payload(payload);

  const [selectedParticipantIds, setSelectedParticipantIds] = useState<
    string[]
  >(
    validPayload instanceof type.errors
      ? []
      : validPayload.participants.map((p) => p.id),
  );

  if (validPayload instanceof type.errors) {
    return <ValidationError errors={validPayload} />;
  }

  const actorParticipant = validPayload.participants.find(
    (p) => p.id === validPayload.actorParticipantId,
  );

  const otherParticipants = [
    ...validPayload.participants.filter(
      (p) => p.id !== validPayload.actorParticipantId,
    ),
    ...validPayload.participants.filter(
      (p) => p.id !== validPayload.actorParticipantId,
    ),
  ];

  const checkParticipant = (participantId: string) => {
    setSelectedParticipantIds((prev) => [...prev, participantId]);
  };

  const uncheckParticipant = (participantId: string) => {
    setSelectedParticipantIds((prev) =>
      prev.filter((id) => id !== participantId),
    );
  };

  return (
    <div className="h-full flex flex-col gap-6">
      <div>
        <h1 className="text-heading-base font-semibold">Checka in</h1>
        <p className="text-body-base">Välj vilka du vill checka in.</p>
      </div>

      <div className="overflow-y-auto">
        {actorParticipant && (
          <ScoutListView>
            <ScoutListViewItem
              type="checkbox"
              primary={`${actorParticipant.firstName} ${actorParticipant.lastName}`}
              checked={selectedParticipantIds.includes(actorParticipant.id)}
              onScoutChecked={(e) => {
                if (e.detail.checked) {
                  checkParticipant(actorParticipant.id);
                } else {
                  uncheckParticipant(actorParticipant.id);
                }
              }}
            />
          </ScoutListView>
        )}

        <ScoutListView>
          {otherParticipants.map((participant) => (
            <ScoutListViewItem
              key={participant.id}
              type="checkbox"
              primary={`${participant.firstName} ${participant.lastName}`}
              checked={selectedParticipantIds.includes(participant.id)}
              onScoutChecked={(e) => {
                if (e.detail.checked) {
                  checkParticipant(participant.id);
                } else {
                  uncheckParticipant(participant.id);
                }
              }}
            />
          ))}
        </ScoutListView>

        <div className="flex justify-end">
          <ScoutButton variant="primary">Checka in valda</ScoutButton>
        </div>
      </div>
    </div>
  );
}
