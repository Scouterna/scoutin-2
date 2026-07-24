import {
  LANGUAGE_LABELS,
  type StepImplementation,
  SUPPORTED_LANGUAGES,
  typedMethod,
} from "@scouterna/scoutin-plugin-api/backend";
import { type } from "arktype";

/**
 * Lets the participant pick the language the rest of the session runs in.
 *
 * Meant as the first step of a flow. Everything after it gets its config text
 * resolved in the chosen language (localized `{ sv, en }` maps are collapsed
 * per session language by the flow engine), and the client switches its own
 * strings when the session language changes.
 *
 * The screen itself is intentionally bilingual - at that point we don't yet
 * know what the user reads - so it takes no localizable text inputs.
 */
export const selectLanguage: StepImplementation = {
  id: "base:selectLanguage",
  inputs: type({
    /** Restricts / orders the offered languages. Defaults to all supported. */
    "languages?": "string[]",
  }),
  outputs: type({
    language: "string",
  }),
  hooks: {
    async onStepStart(ctx) {
      const { languages } = ctx.getInputs() as { languages?: string[] };

      const offered = (languages ?? [...SUPPORTED_LANGUAGES]).filter(
        (language): language is keyof typeof LANGUAGE_LABELS =>
          language in LANGUAGE_LABELS,
      );

      if (offered.length === 0) {
        throw new Error(
          `No supported languages to offer. Got: ${JSON.stringify(languages)}`,
        );
      }

      await ctx.showScreen("base:selectLanguage:select", {
        languages: offered.map((language) => ({
          code: language,
          label: LANGUAGE_LABELS[language],
        })),
      });
    },
  },
  publicMethods: {
    select: typedMethod({
      inputs: type({
        language: "string",
      }),
      async handler(ctx, { language }) {
        await ctx.setLanguage(language);
        await ctx.setCompleted({ language });
      },
    }),
  },
};
