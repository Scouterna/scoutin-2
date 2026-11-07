import type { ImportEnricher } from "@scouterna/scoutin-plugin-api/backend";
import { type } from "arktype";

// Structural subset of the raw Scoutnet participant record this enricher reads.
const SourceRecord = type({
  "primary_membership_info?": {
    "group_name?": "string | null",
  },
});

/**
 * Writes `{ name }`, the name of the participant's primary scout group, or
 * `{ name: null }` when Scoutnet has none. Lands in metadata under the key the
 * data source's `enrichWith` assigns.
 */
export const primaryGroup: ImportEnricher = {
  name: "scoutnet:primaryGroup",
  target: "participant",
  enrich(_entity, ctx): { name: string | null } {
    const record = SourceRecord(ctx.sourceRecord ?? {});

    if (record instanceof type.errors) {
      console.warn(
        "Parsing source record failed while getting primary group:",
        record.summary,
      );
      return { name: null };
    }

    return { name: record.primary_membership_info?.group_name?.trim() || null };
  },
};
