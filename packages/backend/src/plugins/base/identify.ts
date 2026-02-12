import { type } from "arktype";
import type { StepImplementation } from "../../core/workflow/stepImplementation.ts";
import {
  dataSourceConfig,
  findParticipantsByLookupValue,
} from "../../domains/participants/data.service.ts";
import type { Participant } from "../../generated/prisma/client.ts";
import { typedMethod } from "../../plugin-utils/implementation.ts";

/**
 * Normalizes Swedish personal identity number (personnummer).
 * - Checks if the input looks like a valid personal identity number. If not, returns null.
 * - Removes non-digit characters (e.g., hyphens, spaces)
 * - If the number has 10 digits, checks if the date is more than 100 years ago.
 *   If so, prepends the current century to make it 12 digits. Otherwise,
 *   prepends the previous century.
 */
const normalizePersonalIdentityNumber = (ssno: string) => {
  ssno = ssno.replace(/\s+/g, "");

  const pinRegex =
    /^(?<year>(?:\d{2})?\d{2})(?<month>\d{2})(?<day>\d{2})-?(?<lastfour>\d{4})$/;
  const match = ssno.match(pinRegex);
  if (!match || !match.groups) {
    return null;
  }

  const { year, month, day } = match.groups;
  if (!year || !month || !day) {
    return null;
  }

  const yearNumber = Number.parseInt(year, 10);

  let yearPadding = "";
  if (year.length === 2) {
    const currentYearLastTwo = new Date().getFullYear() % 100;
    const currentYearFirstTwo = Math.floor(new Date().getFullYear() / 100);

    // Check if the date is more than 100 years ago
    if (yearNumber > currentYearLastTwo) {
      yearPadding = (currentYearFirstTwo - 1).toString();
    } else {
      yearPadding = currentYearFirstTwo.toString();
    }
  }

  return `${yearPadding}${year}${month}${day}-${match.groups.lastfour}`;
};

const normalizeQuery = (query: string) => {
  const trimmedQuery = query.trim();

  // Try to normalize as personal identity number
  const normalizedPin = normalizePersonalIdentityNumber(trimmedQuery);
  if (normalizedPin) {
    return normalizedPin;
  }

  // Otherwise, return the trimmed query
  return trimmedQuery;
};

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

        const actor = actors[0];

        if (!actor) {
          throw new Error("Actors set in state but empty");
        }

        await ctx.setCompleted({
          dataSource: actor.dataSource,
          actorId: actor.id,
        });
      },
    }),
  },
};
