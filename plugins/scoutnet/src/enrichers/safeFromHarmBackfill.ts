/**
 * Safe from Harm (Trygga Möten) completion normally comes from Scoutnet's
 * `pc_courses` map (course ID "89"), but that doesn't reliably cover staff
 * whose completion isn't captured in Scoutnet's own tracked course data. A
 * separate list backfills those entries, keyed by membership number
 * (`member_no` / `idInDataSource`) - mirrors criminalRecordExtractBackfill.ts.
 *
 * That list will eventually be a SharePoint-backed lookup. Until it's wired
 * up, this is a mock: a static, empty-by-default set that can be seeded here
 * or overridden per-call. Swap the body of `isCompletedInBackfill` (or
 * replace `MOCK_BACKFILL` with a real fetch) when the SharePoint source is
 * ready - the enricher that calls this doesn't need to change.
 */
export const MOCK_BACKFILL: ReadonlySet<string> = new Set([
  // Seed member numbers here for local/dev verification, e.g. "123456".
]);

export function isCompletedInBackfill(
  memberNo: string,
  backfill: ReadonlySet<string> = MOCK_BACKFILL,
): boolean {
  return backfill.has(memberNo);
}
