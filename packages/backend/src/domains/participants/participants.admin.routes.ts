import { Hono } from "hono";
import { loadAllDataSourcesIntoDatabase } from "./data.service.ts";

export const participantsAdminRouter = new Hono().post(
  "/reimport",
  async (c) => {
    await loadAllDataSourcesIntoDatabase();
    return c.body(null, 204);
  },
);
