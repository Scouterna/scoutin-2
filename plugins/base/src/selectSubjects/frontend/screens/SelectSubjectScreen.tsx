import {
  usePluginSocket,
  useTranslations,
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
  "preCheckedIn?": "boolean",
});
// type Participant = typeof Participant.infer;

const dict = {
  sv: {
    title: "Checka in",
    description:
      "Välj vilka du vill checka in. Avmarkera de som inte är på plats.",
    otherSubGroup: "Övriga",
    selectedCount: "{selected} av {total} valda",
    deselectAll: "Avmarkera alla",
    selectAll: "Markera alla",
    submit: "Checka in {selected}/{total} deltagare",
  },
  en: {
    title: "Check in",
    description:
      "Select who you want to check in. Deselect anyone who isn't here.",
    otherSubGroup: "Others",
    selectedCount: "{selected} of {total} selected",
    deselectAll: "Deselect all",
    selectAll: "Select all",
    submit: "Check in {selected}/{total} participants",
  },
};

const Payload = type({
  "title?": "string | undefined",
  "description?": "string | undefined",
  actorParticipantId: "string",
  participants: Participant.array(),
  subGroups: type({
    id: "string",
    // Already resolved for the session language by the backend.
    name: "string",
  }).array(),
});

export function SelectSubjectScreen({ payload }: { payload: object }) {
  const socket = usePluginSocket();
  const t = useTranslations(dict);

  const validPayload = Payload(payload);

  const [submitted, setSubmitted] = useState(false);
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<
    string[]
  >(() => {
    if (validPayload instanceof type.errors) return [];

    // If any subject was pre-checked-in, default to exactly that set.
    // Otherwise (no pre-check-in happened) default to selecting everyone.
    const preCheckedIn = validPayload.participants.filter(
      (p) => p.preCheckedIn,
    );
    return (
      preCheckedIn.length > 0 ? preCheckedIn : validPayload.participants
    ).map((p) => p.id);
  });

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
    subGroupNames[subGroup.id] = subGroup.name;
  }

  for (const participant of validPayload.participants) {
    const key = participant.subGroup ?? "";
    if (!(key in subGroupNames)) {
      subGroupNames[key] = key || t("otherSubGroup");
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
    // Guard against double-tapping: two confirmSubjects calls can otherwise be
    // in flight at once, before the backend has advanced the step. `loading`
    // already blocks the click (it sets the underlying disabled attribute), so
    // this is a backstop for clicks that reach the host element directly. The
    // screen unmounts on step advancement, so neither needs resetting.
    if (submitted) return;
    setSubmitted(true);

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
        <h1 className="text-heading-base font-semibold">
          {validPayload.title ?? t("title")}
        </h1>
        <p className="text-body-base">
          {validPayload.description ?? t("description")}
        </p>
      </div>

      <div className="flex flex-col flex-1 overflow-y-hidden">
        <div className="flex items-center justify-between">
          <div className="text-body-sm text-neutral-500">
            {t("selectedCount", {
              selected: selectedParticipantIds.length,
              total: validPayload.participants.length,
            })}
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
              ? t("deselectAll")
              : t("selectAll")}
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
                    <ScoutListViewSubheader
                      text={subGroupName || t("otherSubGroup")}
                    />

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
            loading={submitted}
            onClick={submitSelected}
          >
            {t("submit", {
              selected: selectedParticipantIds.length,
              total: validPayload.participants.length,
            })}
          </ScoutButton>
        </div>
      </div>
    </div>
  );
}
