import type { ImportEnricher } from "@scouterna/scoutin-plugin-api/backend";
import { type } from "arktype";
import { getBackfillShownAt } from "./criminalRecordExtractBackfill.ts";

// Structural subset of the raw Scoutnet member record this enricher reads.
// pc_details.valid is Scoutnet's own answer to "does this person have a
// valid criminal record extract (registerutdrag) on file" - the API only
// ever reports valid or empty, never a third "flagged" state. `shown` is the
// date (YYYY-MM-DD) the extract was shown, used by the compliance gate to
// apply a configurable validity period.
const SourceRecord = type({
  "pc_details?": type({
    "valid?": "boolean",
    "shown?": "string | null",
  }),
});

export type CriminalRecordExtractStatus = {
  valid: boolean;
  /** Date (YYYY-MM-DD) the registerutdrag was shown, from Scoutnet's
   * `pc_details.shown` or the backfill list, or null if unknown (a backfill
   * entry may omit its date). The compliance gate uses this to apply a
   * configurable validity period. */
  shownAt: string | null;
  /** Which source satisfied the check, or null if neither did. Purely
   * informational (e.g. for the pre-camp report) - the gate only cares about
   * `valid`. */
  source: "scoutnet" | "backfill" | null;
};

/**
 * Writes `metadata.criminalRecordExtract` for every staff participant. Merges
 * two sources per the decided design: Scoutnet's own `pc_details.valid`
 * (primary, covers Swedish staff) OR a backfill list keyed by membership
 * number (covers IST/international staff who aren't in the Swedish register -
 * currently mocked, see criminalRecordExtractBackfill.ts). Anything else -
 * including "no entry in either source" - collapses to `valid: false`; that's
 * an expected state for this check, not an error.
 *
 * Always returns a determinate object (never null/undefined), so the
 * scoutnet:complianceGate step never has to distinguish "this enricher
 * hasn't run yet" from "not valid".
 */
export const criminalRecordExtract: ImportEnricher = {
  name: "scoutnet:criminalRecordExtract",
  target: "participant",
  enrich(entity, ctx): CriminalRecordExtractStatus {
    const parsed = SourceRecord(ctx.sourceRecord ?? {});
    const pcDetails =
      parsed instanceof type.errors ? undefined : parsed.pc_details;

    if (pcDetails?.valid === true) {
      return {
        valid: true,
        shownAt: pcDetails.shown ?? null,
        source: "scoutnet",
      };
    }

    const backfillShownAt = getBackfillShownAt(entity.idInDataSource);
    if (backfillShownAt !== undefined) {
      return { valid: true, shownAt: backfillShownAt, source: "backfill" };
    }

    return { valid: false, shownAt: null, source: null };
  },
};
