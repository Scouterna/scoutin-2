/**
 * Criminal record extract (registerutdrag/belastningsregister) primary status
 * comes from Scoutnet's `pc_details.valid` field, but that source doesn't
 * reliably cover IST/international staff who aren't registered in the
 * Swedish system. A separate list backfills those entries, keyed by
 * membership number (`member_no` / `idInDataSource`).
 *
 * That list will eventually be a SharePoint-backed lookup. Until it's wired
 * up, this is a mock: a static, empty-by-default set that can be seeded here
 * or overridden per-call. Swap the body of `isValidInBackfill` (or replace
 * `MOCK_BACKFILL` with a real fetch) when the SharePoint source is ready -
 * the enricher that calls this doesn't need to change.
 */
export const MOCK_BACKFILL: ReadonlySet<string> = new Set([
  // Seed member numbers here for local/dev verification, e.g. "123456".
]);

export function isValidInBackfill(
  memberNo: string,
  backfill: ReadonlySet<string> = MOCK_BACKFILL,
): boolean {
  return backfill.has(memberNo);
}
