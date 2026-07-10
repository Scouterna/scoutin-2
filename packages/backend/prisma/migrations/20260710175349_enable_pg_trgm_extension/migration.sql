-- Enables typo-tolerant name search (e.g. "malcom" matching "Malcolm") in
-- reports.service.ts's searchRoster via trigram similarity() - additive
-- alongside the existing unaccent()-based exact/substring matching.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
