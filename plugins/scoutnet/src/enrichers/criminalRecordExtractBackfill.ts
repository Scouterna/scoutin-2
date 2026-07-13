/**
 * Criminal record extract (registerutdrag/belastningsregister) primary status
 * comes from Scoutnet's `pc_details.valid` field, but that source doesn't
 * reliably cover IST/international staff who aren't registered in the
 * Swedish system. A separate list backfills those entries, keyed by
 * membership number (`member_no` / `idInDataSource`) and carrying the date
 * (YYYY-MM-DD) the extract was shown, so the compliance gate's validity
 * period applies to backfilled staff too. Use `null` for an entry whose date
 * isn't known.
 *
 * That list will eventually be a SharePoint-backed lookup. Until it's wired
 * up, this is a mock: a static, empty-by-default map that can be seeded here
 * or overridden per-call. Swap the body of `getBackfillShownAt` (or replace
 * `MOCK_BACKFILL` with a real fetch) when the SharePoint source is ready -
 * the enricher that calls this doesn't need to change.
 */
export const MOCK_BACKFILL: ReadonlyMap<string, string | null> = new Map([
  // Seed member numbers -> shown date here for local/dev verification, e.g.
  // ["123456", "2025-01-15"].
]);

/**
 * The date (YYYY-MM-DD) a backfilled member's extract was shown, or `null` if
 * they're in the list without a known date. Returns `undefined` when the
 * member isn't in the backfill list at all.
 */
export function getBackfillShownAt(
  memberNo: string,
  backfill: ReadonlyMap<string, string | null> = MOCK_BACKFILL,
): string | null | undefined {
  return backfill.get(memberNo);
}
