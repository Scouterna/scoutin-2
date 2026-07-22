import type { ImportEnricher } from "@scouterna/scoutin-plugin-api/backend";
import { type } from "arktype";

// Static per-event config passed via the data source's `enrichWith` entry
// (object form): a flat map of metadata field name -> Scoutnet registration
// question ID. Question IDs (and which questions exist at all) are specific
// to a project's registration form, so they're configured per event rather
// than hardcoded here. This enricher has no domain knowledge of what the
// fields mean (diet vs medical vs absence, checkbox vs multiselect vs text) -
// it just copies each configured question's raw answer under its field name.
// Grouping/interpreting by field name happens in the jamboree26:specialNeeds
// step, which is the code contract these field names must match.
const Options = type({
  "questions?": type.Record("string", "string"),
});

// Structural subset of the raw Scoutnet member record this enricher reads.
// `questions` maps question ID -> answer: a plain string for checkbox/text
// questions, but an array of selected choice IDs for multiselect questions
// (confirmed empirically against a real project - see stormote6-followup.md).
// Must accept both, or a single multiselect answer anywhere in a
// participant's form fails validation for their *entire* `questions` object,
// silently nulling out every configured field for that person - this was a
// real bug, not a hypothetical.
const SourceRecord = type({
  "questions?": type.Record("string", "string | string[] | null"),
});

// Shared per-import-cycle context from the provider (see
// ImportEnricherContext.providerContext): question ID -> choice ID -> its
// human-readable label. Used to translate a multiselect answer's raw choice
// IDs (e.g. "61762") into what the person actually saw and picked (e.g.
// "Lördag 11 juli") - confirmed empirically that answers otherwise arrive as
// bare numeric IDs, meaningless without this lookup (see
// stormote6-followup.md).
const ProviderContext = type.Record("string", type.Record("string", "string"));

export const specialNeeds: ImportEnricher = {
  name: "jamboree26:specialNeeds",
  target: "participant",
  enrich(_entity, ctx): Record<string, string | string[] | null> | null {
    const options = Options(ctx.options ?? {});
    const questionMap =
      options instanceof type.errors ? undefined : options.questions;

    if (!questionMap || Object.keys(questionMap).length === 0) {
      // No question IDs configured for this event - nothing to enrich, and
      // nothing to write.
      return null;
    }

    const parsedRecord = SourceRecord(ctx.sourceRecord ?? {});
    const answers =
      parsedRecord instanceof type.errors ? undefined : parsedRecord.questions;

    const parsedProviderContext = ProviderContext(ctx.providerContext ?? {});
    // Fail-safe: if the label lookup is missing/malformed (e.g. the
    // provider's fetch failed this cycle), fall back to the raw choice IDs
    // rather than dropping the answer entirely.
    const choiceLabelsByQuestion =
      parsedProviderContext instanceof type.errors
        ? undefined
        : parsedProviderContext;

    const result: Record<string, string | string[] | null> = {};
    for (const [fieldName, questionId] of Object.entries(questionMap)) {
      const rawAnswer = answers?.[questionId] ?? null;
      const choiceLabels = choiceLabelsByQuestion?.[questionId];
      // Checkbox questions ALSO carry a `choices` map in providerContext, keyed
      // "0"/"1" with localized labels ("unchecked"/"checked", "ej ikryssad"/...
      // depending on the registrant's form locale). Translating those would turn
      // a raw "0"/"1" into a word, and the consuming step's isChecked() would then
      // read "unchecked" as truthy - rendering every answered box as checked (real
      // bug). So a boolean-shaped choice map (keys only "0"/"1") means "checkbox":
      // keep the raw "0"/"1". Real single-choice/multiselect questions use large
      // numeric choice IDs, never "0"/"1", so this never suppresses a genuine
      // dropdown/multiselect translation.
      const isBooleanChoiceMap =
        choiceLabels != null &&
        Object.keys(choiceLabels).length > 0 &&
        Object.keys(choiceLabels).every((k) => k === "0" || k === "1");
      if (Array.isArray(rawAnswer)) {
        result[fieldName] = rawAnswer.map(
          (choiceId) => choiceLabels?.[choiceId] ?? choiceId,
        );
      } else if (
        rawAnswer != null &&
        choiceLabels?.[rawAnswer] != null &&
        !isBooleanChoiceMap
      ) {
        // Dropdown / single-choice: a real choice ID worth translating to the
        // label the person actually saw (e.g. "60173" -> "Programfunktionär").
        result[fieldName] = choiceLabels[rawAnswer];
      } else {
        // Checkbox ("0"/"1"), free text, or a value with no matching label:
        // store the raw answer unchanged.
        result[fieldName] = rawAnswer;
      }
    }
    return result;
  },
};
