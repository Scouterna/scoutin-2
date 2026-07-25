import {
  dataSourceConfig,
  getSubjectCandidates,
} from "@scouterna/scoutin-backend/plugin-services";
import {
  resolveLocalized,
  type StepImplementation,
} from "@scouterna/scoutin-plugin-api/backend";
import { type } from "arktype";

const ConfirmSubjectsInputs = type({
  participantIds: "string[]",
});
type ConfirmSubjectsInputs = typeof ConfirmSubjectsInputs.infer;

export const selectSubjects: StepImplementation = {
  id: "base:selectSubjects",
  inputs: type({
    "title?": "string",
    "description?": "string",
  }),
  // outputs: type({
  //   dataSource: type("string"),
  //   actorId: type("string"),
  // }),
  hooks: {
    async onStepStart(ctx) {
      const { title, description } = ctx.getInputs() as {
        title?: string;
        description?: string;
      };

      const actor = await ctx.getActor();

      if (!actor) {
        throw new Error(
          "No actor found in context when starting selectSubjects step",
        );
      }

      const participants = await getSubjectCandidates(actor.participant.id);

      const dataSource =
        dataSourceConfig.dataSources[actor.participant.dataSource];

      // Names are resolved here rather than on the screen so the client never
      // has to know about locale maps.
      const subGroups = Object.entries(dataSource.subGroups || {}).map(
        ([id, subGroup]) => ({
          id,
          name: resolveLocalized(subGroup.name, ctx.language),
        }),
      );

      await ctx.showScreen("base:selectSubjects:selectSubjects", {
        title,
        description,
        actorParticipantId: actor.participant.id,
        participants: participants.map((p) => ({
          id: p.id,
          firstName: p.firstName,
          lastName: p.lastName,
          subGroup: p.subGroup,
          preCheckedIn: p.preliminaryCheckedInAt !== null,
        })),
        subGroups,
      });
    },
    async onStepRollback(ctx) {
      // Rolling back deletes this step's data but not the subject rows it
      // wrote, so they must be cleared here — otherwise the re-run selection
      // is layered on top of the previous one.
      await ctx.clearSubjects();
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
