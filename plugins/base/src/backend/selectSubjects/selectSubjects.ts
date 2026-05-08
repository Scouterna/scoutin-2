import { getSubjectCandidates } from "@scouterna/scoutin-backend/plugin-services";
import type { StepImplementation } from "@scouterna/scoutin-plugin-api/backend";

type State = {};

export const selectSubjects: StepImplementation<State> = {
  id: "base:selectSubjects",
  // inputs: type({
  //   "scannerSide?": "'top' | 'bottom' | 'left' | 'right'",
  // }),
  // outputs: type({
  //   dataSource: type("string"),
  //   actorId: type("string"),
  // }),
  hooks: {
    async onStepStart(ctx) {
      const actor = await ctx.getActor();

      if (!actor) {
        throw new Error(
          "No actor found in context when starting selectSubjects step",
        );
      }

      const participants = await getSubjectCandidates(actor.participantId);

      await ctx.showScreen("base:selectSubjects:selectSubjects", {
        actorParticipantId: actor.participantId,
        participants,
      });
    },
    async onStepRollback(ctx) {
      // await ctx.clearActor();
    },
  },
};
