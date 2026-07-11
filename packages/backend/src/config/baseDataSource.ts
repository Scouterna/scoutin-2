import { type } from "arktype";

export const BaseDataSource = type({
  name: "Record<string, string>",
  "subGroups?": type.Record("string", {
    name: "Record<string, string>",
  }),
  "activeFrom?": "string",
  "activeTo?": "string",
  // Maps a metadata key to a registered import enricher, e.g.
  // `village: stormote6:villageLookup`. Same shape as `subGroupConditions`.
  // Either the bare enricher name (string form), or an object form carrying
  // static per-entry `options` passed through to the enricher's context (e.g.
  // event-specific Scoutnet question IDs) - see EnrichWithEntry.
  "enrichWith?": type.Record(
    "string",
    type("string").or({
      name: "string",
      "options?": "Record<string, unknown>",
    }),
  ),
});
export type BaseDataSource = typeof BaseDataSource.infer;

export type EnrichWithMap = NonNullable<BaseDataSource["enrichWith"]>;
export type EnrichWithEntry = EnrichWithMap[string];
