-- Enables accent-insensitive name search (e.g. "e" matching "é") in
-- reports.service.ts's searchRoster - Postgres can't do this via a plain
-- ILIKE, it needs the unaccent() function from this contrib extension.
CREATE EXTENSION IF NOT EXISTS unaccent;
