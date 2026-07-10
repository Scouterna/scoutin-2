import type { ImportEnricher } from "@scouterna/scoutin-plugin-api/backend";

/**
 * Trivial demo enricher used to verify the registerImportEnricher path
 * end-to-end (see Fas 3 in stormote6-followup.md) without depending on any
 * real external data source. Not used for any real event.
 */
export const staticGroupTag: ImportEnricher = {
  name: "test:staticGroupTag",
  target: "group",
  enrich(entity) {
    return { tag: `hello ${entity.name}` };
  },
};
