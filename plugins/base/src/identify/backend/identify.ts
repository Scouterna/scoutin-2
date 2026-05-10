import {
  dataSourceConfig,
  findParticipantsByLookupValue,
  type Participant,
} from "@scouterna/scoutin-backend/plugin-services";
import type {
  StepImplementation,
  StepMethodContext,
} from "@scouterna/scoutin-plugin-api/backend";
import { typedMethod } from "@scouterna/scoutin-plugin-api/backend";
import { type } from "arktype";
import { normalizeQuery } from "./utils.ts";

type Candidate = {
  id: string;
  firstName: string;
  lastName: string;
  subGroup?: string | null;
  dataSource: string;
  dataSourceName: Record<string, string>;
};

const participantToCandidate = (p: Participant): Candidate => {
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
    subGroup: p.subGroup,
    dataSource: p.dataSource,
    dataSourceName: dataSource.name,
  };
};

type State = {
  candidates?: Candidate[];
};

export const identify: StepImplementation<State> = {
  id: "base:identify",
  inputs: type({
    "scannerSide?": "'top' | 'bottom' | 'left' | 'right'",
  }),
  outputs: type({
    dataSource: type("string"),
    actorId: type("string"),
    participant: type({
      id: "string",
      firstName: "string",
      lastName: "string",
      dataSource: "string",
      dataSourceName: "Record<string, string>",
    }),
  }),
  hooks: {
    async onStepStart(ctx) {
      await ctx.showScreen("base:identify:start", {
        scannerSide: ctx.getInputs().scannerSide,
      });
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

        const candidates = participants.map(participantToCandidate);
        ctx.setState("candidates", candidates);

        if (candidates.length === 1 && candidates[0]) {
          await ctx.showScreen("base:identify:previewActor", {
            candidate: candidates[0],
          });
        } else {
          await ctx.showScreen("base:identify:selectActor", {
            candidates,
          });
        }
      },
    }),
    selectActor: typedMethod({
      inputs: type({
        participantId: type("string"),
      }),
      async handler(ctx: StepMethodContext<State>, inputs: unknown) {
        const typedInputs = inputs as { participantId: string };
        const candidates = ctx.getState("candidates");
        if (!candidates) {
          throw new Error("Candidates not set in state");
        }

        const candidate = candidates.find(
          (a) => a.id === typedInputs.participantId,
        );
        if (!candidate) {
          throw new Error(
            `Selected participant with id ${typedInputs.participantId} not found in state`,
          );
        }

        ctx.setState("candidates", [candidate]);

        await ctx.showScreen("base:identify:previewActor", {
          candidate,
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
        const candidates = ctx.getState("candidates");
        if (!candidates) {
          throw new Error("Candidates not set in state");
        }

        if (candidates.length !== 1) {
          throw new Error(
            `Expected exactly one candidate in state, but found ${candidates.length}`,
          );
        }

        // biome-ignore lint/style/noNonNullAssertion: Length is checked above
        const candidate = candidates[0]!;

        await ctx.setActor({ participantId: candidate.id });

        await ctx.setCompleted({
          dataSource: candidate.dataSource,
          actorId: candidate.id,
          participant: candidate,
        });
      },
    }),
  },
};
