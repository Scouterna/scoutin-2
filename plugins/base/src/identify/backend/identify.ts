import {
  dataSourceConfig,
  findParticipantsByLookupValue,
  isBlocked,
  normalizeIdentifier,
  type Participant,
} from "@scouterna/scoutin-backend/plugin-services";
import type {
  StepImplementation,
  StepMethodContext,
} from "@scouterna/scoutin-plugin-api/backend";
import {
  resolveLocalized,
  typedMethod,
} from "@scouterna/scoutin-plugin-api/backend";
import { type } from "arktype";

// Dedicated terminal screen shown when a blocked identifier is submitted. The
// screen is registered by the blocklist frontend plugin and self-resets the
// kiosk after a short timeout.
const BLOCKED_SCREEN = "base:blocklist:blocked";

type Candidate = {
  id: string;
  firstName: string;
  lastName: string;
  subGroup?: string | null;
  dataSource: string;
  /** Already resolved for the session language, ready to render. */
  dataSourceName: string;
};

const participantToCandidate = (
  p: Participant,
  language: string,
): Candidate => {
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
    dataSourceName: resolveLocalized(dataSource.name, language),
  };
};

async function searchCandidates(
  query: string,
  language: string,
  dataSources?: string[],
): Promise<Candidate[]> {
  const participants = await findParticipantsByLookupValue(query);
  const now = new Date();
  const filtered = participants.filter((p) => {
    const ds = dataSourceConfig.dataSources[p.dataSource];
    // A participant whose data source is no longer configured (e.g. a past
    // event's source removed from dataSourceConfig.yml, with stale rows left
    // in the DB) can never be identified - treat it like "not a candidate",
    // not a hard error.
    if (!ds) return false;

    if (dataSources && !dataSources.includes(p.dataSource)) return false;
    if (ds.activeFrom && new Date(ds.activeFrom) > now) return false;
    if (ds.activeTo && new Date(ds.activeTo) < now) return false;

    return true;
  });
  return filtered.map((p) => participantToCandidate(p, language));
}

async function autoConfirm(
  ctx: StepMethodContext<State>,
  candidate: Candidate,
) {
  ctx.setState("candidates", [candidate]);
  await ctx.setActor({ participantId: candidate.id });
  await ctx.setCompleted({
    dataSource: candidate.dataSource,
    actorId: candidate.id,
    participant: candidate,
  });
}

async function showCandidates(
  ctx: StepMethodContext<State>,
  candidates: Candidate[],
  skipConfirmation?: boolean,
) {
  ctx.setState("candidates", candidates);

  if (candidates.length === 1 && candidates[0]) {
    if (skipConfirmation) {
      await autoConfirm(ctx, candidates[0]);
    } else {
      await ctx.showScreen("base:identify:previewActor", {
        candidate: candidates[0],
      });
    }
  } else {
    await ctx.showScreen("base:identify:selectActor", { candidates });
  }
}

const Inputs = type({
  "scannerSide?": "'top' | 'bottom' | 'left' | 'right'",
  "identifierHint?": "string",
  "dataSources?": "string[]",
  "skipConfirmation?": "boolean",
  "title?": "string",
  "description?": "string",
  "hideCallout?": "boolean",
  "hideScannerArrow?": "boolean",
  "manualEntryLabel?": "string",
  "largeManualEntryButton?": "boolean",
});

type Inputs = typeof Inputs.infer;

type State = {
  candidates?: Candidate[];
};

export const identify: StepImplementation<State> = {
  id: "base:identify",
  inputs: Inputs,
  outputs: type({
    dataSource: type("string"),
    actorId: type("string"),
    participant: type({
      id: "string",
      firstName: "string",
      lastName: "string",
      dataSource: "string",
      dataSourceName: "string",
    }),
  }),
  hooks: {
    async onStepStart(ctx) {
      const {
        scannerSide,
        identifierHint,
        dataSources,
        skipConfirmation,
        title,
        description,
        hideCallout,
        hideScannerArrow,
        manualEntryLabel,
        largeManualEntryButton,
      } = ctx.getInputs() as Inputs;

      if (identifierHint != null) {
        if (await isBlocked(String(identifierHint))) {
          await ctx.showScreen(BLOCKED_SCREEN, {});
          return;
        }

        const candidates = await searchCandidates(
          normalizeIdentifier(String(identifierHint)),
          ctx.language,
          dataSources,
        );
        if (candidates.length > 0) {
          await showCandidates(ctx, candidates, skipConfirmation);
          return;
        }
      }

      await ctx.showScreen("base:identify:start", {
        scannerSide,
        title,
        description,
        hideCallout,
        hideScannerArrow,
        manualEntryLabel,
        largeManualEntryButton,
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

        // Native blocklist gate: runs on the raw query before resolution, so it
        // catches both participants (via any of their identifiers) and people
        // who aren't in the participants table.
        if (await isBlocked(typedInputs.query)) {
          await ctx.showScreen(BLOCKED_SCREEN, {});
          return;
        }

        const { dataSources, skipConfirmation } = ctx.getInputs() as Inputs;
        const candidates = await searchCandidates(
          normalizeIdentifier(typedInputs.query),
          ctx.language,
          dataSources,
        );

        if (candidates.length === 0) {
          await ctx.sendMessage("base:identify:noResults", {
            query: typedInputs.query,
          });
          return;
        }

        await showCandidates(ctx, candidates, skipConfirmation);
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

        const { skipConfirmation } = ctx.getInputs() as Inputs;
        if (skipConfirmation) {
          await autoConfirm(ctx, candidate);
        } else {
          ctx.setState("candidates", [candidate]);
          await ctx.showScreen("base:identify:previewActor", { candidate });
        }
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
