import {
  usePluginSocket,
  ValidationError,
} from "@scouterna/scoutin-plugin-api/frontend";
import {
  ScoutButton,
  ScoutListView,
  ScoutListViewItem,
  ScoutListViewSubheader,
} from "@scouterna/ui-react";
import ArrowRightIcon from "@tabler/icons/outline/arrow-right.svg?raw";
import { type } from "arktype";
import { useState } from "react";

const Participant = type({
  id: "string",
  firstName: "string",
  lastName: "string",
  "subGroup?": "string | null",
});
// type Participant = typeof Participant.infer;

const Payload = type({
  actorParticipantId: "string",
  participants: Participant.array(),
  subGroups: type({
    id: "string",
    name: "Record<string, string>",
  }).array(),
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

  const participantsGroupedBySubGroup: Record<
    string,
    typeof validPayload.participants
  > = {};

  for (const participant of validPayload.participants) {
    const subGroupId = participant.subGroup ?? "";
    if (!participantsGroupedBySubGroup[subGroupId]) {
      participantsGroupedBySubGroup[subGroupId] = [];
    }
    participantsGroupedBySubGroup[subGroupId].push(participant);
  }

  const subGroupNames: Record<string, string> = {};
  for (const subGroup of validPayload.subGroups) {
    subGroupNames[subGroup.id] = subGroup.name.sv;
  }

  for (const participant of validPayload.participants) {
    const key = participant.subGroup ?? "";
    if (!(key in subGroupNames)) {
      subGroupNames[key] = key || "Övriga";
    }
  }

  const checkParticipant = (participantId: string) => {
    setSelectedParticipantIds((prev) => [...new Set([...prev, participantId])]);
  };

  const uncheckParticipant = (participantId: string) => {
    setSelectedParticipantIds((prev) =>
      prev.filter((id) => id !== participantId),
    );
  };

  const submitSelected = () => {
    socket?.send({
      name: "step:callMethod",
      data: {
        name: "confirmSubjects",
        inputs: {
          participantIds: selectedParticipantIds,
        },
      },
    });
  };

  return (
    <div className="h-full flex flex-col gap-6">
      <div>
        <h1 className="text-heading-base font-semibold">Checka in</h1>
        <p className="text-body-base">Välj vilka du vill checka in.</p>
      </div>

      <div className="flex flex-col flex-1 overflow-y-hidden">
        <div className="flex items-center justify-between">
          <div className="text-body-sm text-neutral-500">
            {selectedParticipantIds.length} av{" "}
            {validPayload.participants.length} valda
          </div>

          <ScoutButton
            variant="text"
            onScoutClick={() => {
              if (
                selectedParticipantIds.length ===
                validPayload.participants.length
              ) {
                setSelectedParticipantIds([]);
              } else {
                setSelectedParticipantIds(
                  validPayload.participants.map((p) => p.id),
                );
              }
            }}
          >
            {selectedParticipantIds.length === validPayload.participants.length
              ? "Avmarkera alla"
              : "Markera alla"}
          </ScoutButton>
        </div>

        <div className="relative flex-1 overflow-hidden mb-4">
          <div className="absolute bottom-0 inset-x-2 h-0 [box-shadow:0_0_11px_3px_rgba(0,0,0,0.2)] pointer-events-none z-10" />
          <div className="absolute top-0 inset-x-2 h-0 [box-shadow:0_0_11px_3px_rgba(0,0,0,0.2)] pointer-events-none z-10" />
          <div className="h-full overflow-y-auto overflow-x-hidden">
            <div className="">
              {Object.entries(subGroupNames).map(
                ([subGroupId, subGroupName]) => (
                  <ScoutListView key={subGroupId}>
                    <ScoutListViewSubheader text={subGroupName || "Övriga"} />

                    {participantsGroupedBySubGroup[subGroupId]?.map(
                      (participant) => (
                        <ScoutListViewItem
                          key={participant.id}
                          type="checkbox"
                          primary={`${participant.firstName} ${participant.lastName}`}
                          checked={selectedParticipantIds.includes(
                            participant.id,
                          )}
                          onScoutChecked={(e) => {
                            console.log(
                              "checked",
                              participant.id,
                              e.detail.checked,
                            );
                            if (e.detail.checked) {
                              checkParticipant(participant.id);
                            } else {
                              uncheckParticipant(participant.id);
                            }
                          }}
                        />
                      ),
                    )}
                  </ScoutListView>
                ),
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <ScoutButton
            variant="primary"
            icon={ArrowRightIcon}
            iconPosition="after"
            disabled={selectedParticipantIds.length === 0}
            onClick={submitSelected}
          >
            Checka in {selectedParticipantIds.length}/
            {validPayload.participants.length} deltagare
          </ScoutButton>
        </div>
      </div>
    </div>
  );
}
