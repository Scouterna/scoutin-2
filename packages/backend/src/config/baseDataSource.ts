import { type } from "arktype";

export const BaseDataSource = type({
  name: "Record<string, string>",
  "subGroups?": type.Record("string", {
    name: "Record<string, string>",
  }),
});
export type BaseDataSource = typeof BaseDataSource.infer;
