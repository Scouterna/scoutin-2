import {
  usePluginSocket,
  ValidationError,
} from "@scouterna/scoutin-plugin-api/frontend";
import { ScoutListView, ScoutListViewItem } from "@scouterna/ui-react";
import { type } from "arktype";
import { Fragment } from "react";

const Candidate = type({
  id: "string",
  firstName: "string",
  lastName: "string",
  dataSourceName: "Record<string, string>",
});
type Candidate = typeof Candidate.infer;

const Payload = type({
  candidates: Candidate.array(),
});

export function SelectActorScreen({ payload }: { payload: object }) {
  const socket = usePluginSocket();

  const validPayload = Payload(payload);

  if (validPayload instanceof type.errors) {
    return <ValidationError errors={validPayload} />;
  }

  const handleSelect = (candidate: Candidate) => {
    socket?.send({
      name: "step:callMethod",
      data: {
        name: "selectActor",
        inputs: {
          participantId: candidate.id,
        },
      },
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-heading-base font-semibold">
          Du är anmäld på flera sätt
        </h1>
        <p className="text-body-base">Välj hur du vill fortsätta</p>
      </div>

      <ScoutListView className="max-w-md">
        {validPayload.candidates.map((candidate) => (
          <Fragment key={candidate.id}>
            <ScoutListViewItem
              primary={`Som ${candidate.dataSourceName.sv}`}
              action="chevron"
              onClick={() => handleSelect(candidate)}
            />
            {/* {index < validPayload.candidates.length - 1 && <ScoutDivider />} */}
          </Fragment>
        ))}
      </ScoutListView>
    </div>
  );
}
