import { type } from "arktype";

export const BaseDataSource = type({
  name: "Record<string, string>",
  "subGroups?": type.Record("string", {
    name: "Record<string, string>",
  }),
  "activeFrom?": "string",
  "activeTo?": "string",
  // Maps a metadata key to a registered import enricher name, e.g.
  // `village: stormote6:villageLookup`. Same shape as `subGroupConditions`.
  "enrichWith?": type.Record("string", "string"),
});
export type BaseDataSource = typeof BaseDataSource.infer;
