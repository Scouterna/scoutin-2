import type { ImportEnricher } from "@scouterna/scoutin-plugin-api/backend";
import { type } from "arktype";
import { firstAttendingDate } from "../specialNeeds/attendance.ts";

// Static per-event config passed via the data source's `enrichWith` entry
// (object form): a flat map of metadata field name -> Scoutnet registration
// question ID. Question IDs (and which questions exist at all) are specific
// to a project's registration form, so they're configured per event rather
// than hardcoded here. Beyond the single computed `firstAttendingDay` field
// (below), this enricher has no domain knowledge of what the fields mean (diet
// vs medical vs absence, checkbox vs multiselect vs text) - it just copies each
// configured question's raw answer under its field name. Grouping/interpreting
// by field name happens in the jamboree26:specialNeeds step, which is the code
// contract these field names must match.
//
// `variant` is the one bit of domain config this enricher takes: it selects the
// attendance model (see ../specialNeeds/attendance.ts) used to derive the single
// computed `firstAttendingDay` field (an ISO yyyy-mm-dd string). It mirrors the
// jamboree26:specialNeeds step's own `variant` input - `adult` for the funktionär
// form's period-gate/absence model, `child` for the "medföljande barn" form's
// positive attend-list. Omit it and no firstAttendingDay is written (the raw
// answer fields are still copied as before), so sources with no attendance data
// (e.g. groups) stay unaffected.
const Options = type({
  "questions?": type.Record("string", "string"),
  "variant?": "'adult' | 'child'",
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
    const variant =
      options instanceof type.errors ? undefined : options.variant;

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

    // Derive the single computed convenience field: the first day this person is
    // actually attending, as an ISO yyyy-mm-dd string, for the roster export's
    // "first attending day" column. Uses the just-resolved labels in `result`
    // (periodsAttending/absence* for adults, attendanceDays for children) so it
    // needs no separate question config or provider lookup. Only written when a
    // `variant` is configured and a first day can be determined - otherwise the
    // key is omitted rather than set to null, keeping it out of the export for
    // sources with no attendance data.
    if (variant) {
      const firstDay = firstAttendingDate(result, variant);
      if (firstDay != null) result.firstAttendingDay = firstDay;
    }

    return result;
  },
};
