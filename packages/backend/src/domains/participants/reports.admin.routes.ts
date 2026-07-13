import { arktypeValidator } from "@hono/arktype-validator";
import { type } from "arktype";
import { Hono } from "hono";
import {
  buildRoster,
  buildRosterSummary,
  listParticipants,
  rosterToCsv,
  STATUS_BUCKETS,
  type StatusBucket,
} from "./reports.service.ts";

const SummaryQuery = type({ "locale?": "string" });
const CsvQuery = type({ "locale?": "string", "source?": "string" });
// `q` is optional so the endpoint doubles as a browse (no query) and a search.
// `status` is a comma-separated list of visible StatusBuckets; offset/limit
// page the result. All are strings (query params) and parsed in the handler.
const SearchQuery = type({
  "q?": "string",
  "locale?": "string",
  "offset?": "string",
  "limit?": "string",
  "status?": "string",
});

function parseStatuses(raw: string | undefined): StatusBucket[] | undefined {
  if (raw === undefined) return undefined;
  const valid = new Set<string>(STATUS_BUCKETS);
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is StatusBucket => valid.has(s));
}

function parseNonNegativeInt(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

export const reportsAdminRouter = new Hono()
  .get("/roster", arktypeValidator("query", SummaryQuery), async (c) => {
    const { locale } = c.req.valid("query");
    const summary = await buildRosterSummary({ locale });
    // Always fresh - the frontend polls this for a live dashboard view.
    c.header("Cache-Control", "no-store");
    return c.json(summary);
  })
  .get("/search", arktypeValidator("query", SearchQuery), async (c) => {
    const { q, locale, offset, limit, status } = c.req.valid("query");
    const result = await listParticipants({
      query: q,
      locale,
      offset: parseNonNegativeInt(offset),
      limit: parseNonNegativeInt(limit),
      statuses: parseStatuses(status),
    });
    c.header("Cache-Control", "no-store");
    return c.json(result);
  })
  .get("/roster.csv", arktypeValidator("query", CsvQuery), async (c) => {
    const { locale, source } = c.req.valid("query");
    const roster = await buildRoster({ locale, sourceKey: source });
    const csv = rosterToCsv(roster);

    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header(
      "Content-Disposition",
      `attachment; filename="roster-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    return c.body(csv);
  });
