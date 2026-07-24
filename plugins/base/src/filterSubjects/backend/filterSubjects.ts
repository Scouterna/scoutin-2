import {
  evaluateExpression,
  prisma,
} from "@scouterna/scoutin-backend/plugin-services";
import type { StepImplementation } from "@scouterna/scoutin-plugin-api/backend";
import { type } from "arktype";

const FilterSubjectsInputs = type({
  // A bare expression (NOT wrapped in ${{ }}) evaluated once per subject with a
  // `{ participant }` context, e.g. "participant.subGroup == 'leaderstaff'".
  // It must be bare because the step engine pre-evaluates ${{ }} in `with`
  // against the flow context (which has no `participant`), so wrapping it there
  // would fail. This step evaluates it itself against each participant.
  filter: "string",
  "title?": "string",
  "message?": "string",
  // May be authored as `{ sv, en }` in config; the flow engine resolves it to
  // a plain string for the session language before we see it.
  "buttonText?": "string",
  // What to do when no subject matches the filter. Defaults to "show" (render
  // the message with an empty list); "skip" auto-completes without a screen.
  "whenEmpty?": "'skip' | 'show'",
});
type FilterSubjectsInputs = typeof FilterSubjectsInputs.infer;

export const filterSubjects: StepImplementation = {
  id: "base:filterSubjects",
  inputs: FilterSubjectsInputs,
  hooks: {
    async onStepStart(ctx) {
      const { filter, title, message, buttonText, whenEmpty } =
        ctx.getInputs() as FilterSubjectsInputs;

      const session = await prisma.checkinSession.findUniqueOrThrow({
        where: { id: ctx.sessionId },
        include: {
          subjects: { include: { participant: true } },
        },
      });

      const matched = session.subjects
        .map((s) => s.participant)
        .filter((participant) => {
          const context = {
            participant: {
              id: participant.id,
              firstName: participant.firstName,
              lastName: participant.lastName,
              subGroup: participant.subGroup,
            },
          };
          // Expressions represent booleans as integers; treat non-zero as true,
          // matching the step engine's `if` handling.
          return Boolean(evaluateExpression(filter, context).number());
        });

      if (matched.length === 0 && (whenEmpty ?? "show") === "skip") {
        await ctx.setCompleted();
        return;
      }

      await ctx.showScreen("base:filterSubjects:filterSubjects", {
        title,
        message,
        buttonText,
        participants: matched.map((p) => ({
          id: p.id,
          firstName: p.firstName,
          lastName: p.lastName,
          subGroup: p.subGroup,
        })),
      });
    },
  },
  publicMethods: {
    confirm: {
      async handler(ctx) {
        await ctx.setCompleted();
      },
    },
  },
};
