import { type } from "arktype";
import type {
  StepImplementation,
  StepMethodContext,
} from "@scouterna/scoutin-plugin-api";
import { typedMethod } from "@scouterna/scoutin-plugin-api";
import {
  dataSourceConfig,
  findParticipantsByLookupValue,
  type Participant,
} from "@scouterna/scoutin-backend/plugin-services";
import { normalizeQuery } from "./utils.ts";

type Actor = {
  id: string;
  firstName: string;
  lastName: string;
  dataSource: string;
  dataSourceName: Record<string, string>;
};

const participantToActor = (p: Participant): Actor => {
  const dataSource = dataSourceConfig.dataSources[p.dataSource];

  if (!dataSource) {
    throw new Error(
      `Data source with name ${p.dataSource} not found in config for participant ${p.id}`,
    );
  }

  return {
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    dataSource: p.dataSource,
    dataSourceName: dataSource.name,
  };
};

type State = {
  actors?: Actor[];
};

export const identify: StepImplementation<State> = {
  id: "base:identify",
  outputs: type({
    dataSource: type("string"),
    actorId: type("string"),
  }),
  hooks: {
    async onStepStart(ctx) {
      await ctx.showScreen("base:identify:start");
    },
    async onStepRollback(ctx) {
      await ctx.clearActor();
    },
  },
  publicMethods: {
    searchByString: typedMethod({
      inputs: type({
        query: type("string"),
      }),
      async handler(ctx: StepMethodContext<State>, inputs: unknown) {
        const typedInputs = inputs as { query: string };
        const normalizedQuery = normalizeQuery(typedInputs.query);
        const participants =
          await findParticipantsByLookupValue(normalizedQuery);

        if (participants.length === 0) {
          await ctx.sendMessage("base:identify:noResults", {
            query: typedInputs.query,
          });
          return;
        }

        const actors = participants.map(participantToActor);
        ctx.setState("actors", actors);

        if (actors.length === 1 && actors[0]) {
          await ctx.showScreen("base:identify:previewActor", {
            actor: actors[0],
          });
        } else {
          await ctx.showScreen("base:identify:selectActor", {
            actors,
          });
        }
      },
    }),
    selectActor: typedMethod({
      inputs: type({
        actorId: type("string"),
      }),
      async handler(ctx: StepMethodContext<State>, inputs: unknown) {
        const typedInputs = inputs as { actorId: string };
        const actors = ctx.getState("actors");
        if (!actors) {
          throw new Error("Actors not set in state");
        }

        const actor = actors.find((a) => a.id === typedInputs.actorId);
        if (!actor) {
          throw new Error(
            `Selected actor with id ${typedInputs.actorId} not found in state`,
          );
        }

        ctx.setState("actors", [actor]);

        await ctx.showScreen("base:identify:previewActor", {
          actor,
        });
      },
    }),
    denyActor: typedMethod({
      async handler(ctx: StepMethodContext<State>) {
        await ctx.restartStep();
      },
    }),
    confirmActor: typedMethod({
      async handler(ctx: StepMethodContext<State>) {
        const actors = ctx.getState("actors");
        if (!actors) {
          throw new Error("Actors not set in state");
        }

        if (actors.length !== 1) {
          throw new Error(
            `Expected exactly one actor in state, but found ${actors.length}`,
          );
        }

        // biome-ignore lint/style/noNonNullAssertion: Length is checked above
        const actor = actors[0]!;

        await ctx.setActor({ participantId: actor.id });

        await ctx.setCompleted({
          dataSource: actor.dataSource,
          actorId: actor.id,
        });
      },
    }),
  },
};
