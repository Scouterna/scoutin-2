import type { ImportEnricher } from "@scouterna/scoutin-plugin-api/backend";
import { type } from "arktype";

// Per-event config from the data source's `enrichWith` entry (object form): a
// map of metadata field name -> Scoutnet registration question ID.
//
// `otherAnswers` handles an "other, please specify" choice: for the named field,
// when the person picked choice `choice`, that choice is replaced by their text
// answer to `question`.
const Options = type({
  "questions?": type.Record("string", "string"),
  "otherAnswers?": type.Record("string", {
    choice: "string",
    question: "string",
  }),
});

// Raw answers by question ID: a string for text/dropdown/checkbox questions, an
// array of choice IDs for multiselect.
const SourceRecord = type({
  "questions?": type.Record("string", "string | string[] | null"),
});

// Question ID -> choice ID -> label, shared per import cycle by the provider.
const ProviderContext = type.Record("string", type.Record("string", "string"));

/**
 * Copies the configured registration answers into metadata under their field
 * names. Choice IDs (dropdown and multiselect) are translated to the label the
 * person saw; text and checkbox answers are kept as they are. A missing answer
 * is null. If the label lookup is unavailable the raw IDs are kept.
 */
export const formAnswers: ImportEnricher = {
  name: "scoutnet:formAnswers",
  target: "participant",
  enrich(_entity, ctx): Record<string, string | string[] | null> | null {
    const options = Options(ctx.options ?? {});
    const questionMap =
      options instanceof type.errors ? undefined : options.questions;
    const otherAnswers =
      options instanceof type.errors ? undefined : options.otherAnswers;
    if (!questionMap || Object.keys(questionMap).length === 0) return null;

    const record = SourceRecord(ctx.sourceRecord ?? {});
    const answers =
      record instanceof type.errors ? undefined : record.questions;
    const context = ProviderContext(ctx.providerContext ?? {});
    const labels = context instanceof type.errors ? undefined : context;

    const result: Record<string, string | string[] | null> = {};
    for (const [fieldName, questionId] of Object.entries(questionMap)) {
      const answer = answers?.[questionId] ?? null;
      const choices = labels?.[questionId];
      // The label for the "other" choice, or the person's own text if given.
      const other = otherAnswers?.[fieldName];
      const resolveChoice = (id: string): string => {
        if (other && id === other.choice) {
          const text = answers?.[other.question];
          if (typeof text === "string" && text.trim() !== "")
            return text.trim();
        }
        return choices?.[id] ?? id;
      };
      // Checkboxes also have a choice map, keyed "0"/"1" with localized
      // "unchecked"/"checked" labels. Keep their raw "0"/"1".
      const isCheckbox =
        choices != null &&
        Object.keys(choices).length > 0 &&
        Object.keys(choices).every((k) => k === "0" || k === "1");
      if (Array.isArray(answer)) {
        result[fieldName] = answer.map(resolveChoice);
      } else if (
        answer != null &&
        (choices?.[answer] != null || other?.choice === answer) &&
        !isCheckbox
      ) {
        result[fieldName] = resolveChoice(answer);
      } else {
        result[fieldName] = answer;
      }
    }
    return result;
  },
};
