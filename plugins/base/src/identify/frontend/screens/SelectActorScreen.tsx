import {
  usePluginSocket,
  useTranslations,
  ValidationError,
} from "@scouterna/scoutin-plugin-api/frontend";
import { ScoutListView, ScoutListViewItem } from "@scouterna/ui-react";
import { type } from "arktype";
import { Fragment } from "react";

const Candidate = type({
  id: "string",
  firstName: "string",
  lastName: "string",
  dataSourceName: "string",
});
type Candidate = typeof Candidate.infer;

const Payload = type({
  candidates: Candidate.array(),
});

const dict = {
  sv: {
    title: "Du är anmäld på flera sätt",
    description: "Välj hur du vill fortsätta",
    // {name} is the data source name, already resolved server-side.
    asOption: "Som {name}",
  },
  en: {
    title: "You are registered in more than one way",
    description: "Choose how you want to continue",
    asOption: "As {name}",
  },
};

export function SelectActorScreen({ payload }: { payload: object }) {
  const socket = usePluginSocket();
  const t = useTranslations(dict);

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
        <h1 className="text-heading-base font-semibold">{t("title")}</h1>
        <p className="text-body-base">{t("description")}</p>
      </div>

      <ScoutListView className="max-w-md">
        {validPayload.candidates.map((candidate) => (
          <Fragment key={candidate.id}>
            <ScoutListViewItem
              primary={t("asOption", { name: candidate.dataSourceName })}
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
