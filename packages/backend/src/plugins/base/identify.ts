import { type } from "arktype";
import type { StepImplementation } from "../../core/workflow/stepImplementation.ts";
import { findParticipantsByLookupValue } from "../../domains/participants/data.service.ts";
import type { Participant } from "../../generated/prisma/client.ts";

const SearchByStringInputSchema = type({
  query: type("string"),
});

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
};

const participantToActor = (p: Participant): Actor => ({
  id: p.id,
  firstName: p.firstName,
  lastName: p.lastName,
});

export const identify: StepImplementation = {
  id: "base:identify",
  outputs: type({
    dataSource: type("string"),
  }),
  hooks: {
    onStepStart(ctx) {
      ctx.showScreen("base:identify:start");
    },
  },
  publicMethods: {
    searchByString: {
      inputs: SearchByStringInputSchema,
      async handler(ctx, inputs: typeof SearchByStringInputSchema.infer) {
        const normalizedQuery = normalizeQuery(inputs.query);
        const participants =
          await findParticipantsByLookupValue(normalizedQuery);

        console.log(participants.length);

        if (participants.length === 0) {
          await ctx.sendMessage("base:identify:noResults", {
            query: inputs.query,
          });
          return;
        }

        if (participants.length === 1 && participants[0]) {
          const p = participants[0];
          ctx.showScreen("base:identify:previewActor", {
            actor: participantToActor(p),
          });
          return;
        }

        ctx.showScreen("base:identify:selectActor", {
          actors: participants.map(participantToActor),
        });
      },
    },
    // dummy: {
    //   inputs: type({}),
    //   async handler(ctx, data) {
    //     // ctx.sendMessage("stepMessage", { info: "Dummy method called" });
    //     ctx.showScreen("base:identify:dummy");
    //   },
    // },
  },
};
