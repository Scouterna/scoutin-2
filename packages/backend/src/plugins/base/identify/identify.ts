import { type } from "arktype";
import type { StepImplementation } from "../../../core/workflow/stepImplementation.ts";
import {
  dataSourceConfig,
  findParticipantsByLookupValue,
} from "../../../domains/participants/data.service.ts";
import type { Participant } from "../../../generated/prisma/client.ts";
import { typedMethod } from "../../../plugin-utils/implementation.ts";
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
  },
  publicMethods: {
    searchByString: typedMethod({
      inputs: type({
        query: type("string"),
      }),
      async handler(ctx, inputs) {
        const normalizedQuery = normalizeQuery(inputs.query);
        const participants =
          await findParticipantsByLookupValue(normalizedQuery);

        if (participants.length === 0) {
          await ctx.sendMessage("base:identify:noResults", {
            query: inputs.query,
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
      async handler(ctx, inputs) {
        const actors = ctx.getState("actors");
        if (!actors) {
          throw new Error("Actors not set in state");
        }

        const actor = actors.find((a) => a.id === inputs.actorId);
        if (!actor) {
          throw new Error(
            `Selected actor with id ${inputs.actorId} not found in state`,
          );
        }

        ctx.setState("actors", [actor]);

        await ctx.showScreen("base:identify:previewActor", {
          actor,
        });
      },
    }),
    confirmActor: typedMethod({
      async handler(ctx) {
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
