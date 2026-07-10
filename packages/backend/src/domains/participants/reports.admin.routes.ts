import { arktypeValidator } from "@hono/arktype-validator";
import { type } from "arktype";
import { Hono } from "hono";
import {
  buildRoster,
  buildRosterSummary,
  rosterToCsv,
  searchRoster,
} from "./reports.service.ts";

const SummaryQuery = type({ "locale?": "string" });
const CsvQuery = type({ "locale?": "string", "source?": "string" });
const SearchQuery = type({ q: "string", "locale?": "string" });

export const reportsAdminRouter = new Hono()
  .get("/roster", arktypeValidator("query", SummaryQuery), async (c) => {
    const { locale } = c.req.valid("query");
    const summary = await buildRosterSummary({ locale });
    // Always fresh - the frontend polls this for a live dashboard view.
    c.header("Cache-Control", "no-store");
    return c.json(summary);
  })
  .get("/search", arktypeValidator("query", SearchQuery), async (c) => {
    const { q, locale } = c.req.valid("query");
    const results = await searchRoster(q, { locale });
    c.header("Cache-Control", "no-store");
    return c.json({ results });
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
