import {
  dataSourceConfig,
  getSubjectCandidates,
} from "@scouterna/scoutin-backend/plugin-services";
import type { StepImplementation } from "@scouterna/scoutin-plugin-api/backend";
import { type } from "arktype";

type State = {};

const ConfirmSubjectsInputs = type({
  participantIds: "string[]",
});
type ConfirmSubjectsInputs = typeof ConfirmSubjectsInputs.infer;

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

      const participants = await getSubjectCandidates(actor.participant.id);

      const dataSource =
        dataSourceConfig.dataSources[actor.participant.dataSource];

      const subGroups = Object.entries(dataSource.subGroups || {}).map(
        ([id, subGroup]) => ({
          id,
          name: subGroup.name,
        }),
      );

      await ctx.showScreen("base:selectSubjects:selectSubjects", {
        actorParticipantId: actor.participant.id,
        participants,
        subGroups,
      });
    },
    async onStepRollback(ctx) {
      // await ctx.clearActor();
    },
  },
  publicMethods: {
    confirmSubjects: {
      inputs: ConfirmSubjectsInputs,
      async handler(ctx, inputs: ConfirmSubjectsInputs) {
        await ctx.setSubjects({
          participantIds: inputs.participantIds,
        });

        await ctx.setCompleted();
      },
    },
  },
};
