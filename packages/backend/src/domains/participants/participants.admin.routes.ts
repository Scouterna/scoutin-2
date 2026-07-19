import { Hono } from "hono";
import { DATA_IMPORT_JOB, jobRunner } from "../../core/jobs/jobRunner.ts";
import { undoCheckin } from "./checkin.service.ts";

export const participantsAdminRouter = new Hono()
  .post("/reimport", async (c) => {
    // Route through the job runner so a manual reimport can't overlap the
    // scheduled import. `fresh` guarantees a fetch newer than this request: if
    // a scheduled run is already in flight, a fresh follow-up is queued to run
    // after it (rather than returning that possibly-stale in-flight run), so
    // the operator's click always pulls current data.
    await jobRunner.runNow(DATA_IMPORT_JOB, { fresh: true });
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
