import { Hono } from "hono";
import { undoCheckin } from "./checkin.service.ts";
import { loadAllDataSourcesIntoDatabase } from "./data.service.ts";

export const participantsAdminRouter = new Hono()
  .post("/reimport", async (c) => {
    await loadAllDataSourcesIntoDatabase();
    return c.body(null, 204);
  })
  .post("/:id/undo-checkin", async (c) => {
    const id = c.req.param("id");
    try {
      await undoCheckin(id);
    } catch {
      // undoCheckin throws if the participant does not exist.
      return c.json({ error: "not_found" }, 404);
    }
    return c.body(null, 204);
  });
