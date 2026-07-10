import type { ImportEnricher } from "@scouterna/scoutin-plugin-api/backend";
import { type } from "arktype";
import { isCompletedInBackfill } from "./safeFromHarmBackfill.ts";

/** Scoutnet course ID for the Safe from Harm (Trygga Möten) course (see the
 * `pc_courses` map on getProjectParticipants / getProjectParticipant
 * responses). */
const SAFE_FROM_HARM_COURSE_ID = "89";

// Structural subset of the raw Scoutnet member record this enricher reads.
// `pc_courses` maps course ID -> completion date, or null if not completed.
const SourceRecord = type({
  "pc_courses?": type.Record("string", "string | null"),
});

export type SafeFromHarmStatus = {
  completed: boolean;
  completedAt: string | null;
  /** Which source satisfied the check, or null if neither did. Purely
   * informational (e.g. for the pre-camp report) - the gate only cares about
   * `completed`. `completedAt` is only ever populated from Scoutnet - the
   * backfill list only records that someone completed it, not when. */
  source: "scoutnet" | "backfill" | null;
};

/**
 * Writes `metadata.safeFromHarm` for every staff participant. Merges two
 * sources, mirroring criminalRecordExtract.ts: Scoutnet's own `pc_courses`
 * entry (primary) OR a backfill list keyed by membership number (covers staff
 * whose completion isn't captured in Scoutnet's tracked course data -
 * currently mocked, see safeFromHarmBackfill.ts). Anything else collapses to
 * `completed: false`; that's an expected state for this check, not an error.
 *
 * Always returns a determinate object (never null/undefined), so the
 * scoutnet:complianceGate step never has to distinguish "this enricher
 * hasn't run yet" from "not completed".
 */
export const safeFromHarm: ImportEnricher = {
  name: "scoutnet:safeFromHarm",
  target: "participant",
  enrich(entity, ctx): SafeFromHarmStatus {
    const parsed = SourceRecord(ctx.sourceRecord ?? {});
    const courses =
      parsed instanceof type.errors ? undefined : parsed.pc_courses;
    const completedAt = courses?.[SAFE_FROM_HARM_COURSE_ID] ?? null;

    if (completedAt != null) {
      return { completed: true, completedAt, source: "scoutnet" };
    }

    if (isCompletedInBackfill(entity.idInDataSource)) {
      return { completed: true, completedAt: null, source: "backfill" };
    }

    return { completed: false, completedAt: null, source: null };
  },
};
