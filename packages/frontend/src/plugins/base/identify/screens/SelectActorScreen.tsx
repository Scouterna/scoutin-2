import {
  ScoutDivider,
  ScoutListView,
  ScoutListViewItem,
} from "@scouterna/ui-react";
import { type } from "arktype";
import { useAtomValue } from "jotai";
import { Fragment } from "react";
import { ValidationError } from "@/components/kiosk/ValidationError";
import { socketAtom } from "@/store/socket";

const Actor = type({
  id: "string",
  firstName: "string",
  lastName: "string",
  dataSourceName: "Record<string, string>",
});
type Actor = typeof Actor.infer;

const Payload = type({
  actors: Actor.array(),
});

export function SelectActorScreen({ payload }: { payload: object }) {
  const socket = useAtomValue(socketAtom);

  const validPayload = Payload(payload);

  if (validPayload instanceof type.errors) {
    return <ValidationError errors={validPayload} />;
  }

  const handleSelect = (actor: Actor) => {
    socket?.send({
      name: "step:callMethod",
      data: {
        name: "selectActor",
        inputs: {
          actorId: actor.id,
        },
      },
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-heading-base">Du är anmäld på flera sätt</h1>
        <p className="text-body-base">Välj hur du vill fortsätta</p>
      </div>

      <ScoutListView className="max-w-md">
        {validPayload.actors.map((actor, index) => (
          <Fragment key={actor.id}>
            <ScoutListViewItem
              key={actor.id}
              primary={`Som ${actor.dataSourceName.sv}`}
              action="chevron"
              onClick={() => handleSelect(actor)}
            />
            {index < validPayload.actors.length - 1 && <ScoutDivider />}
          </Fragment>
        ))}
      </ScoutListView>
    </div>
  );
}
