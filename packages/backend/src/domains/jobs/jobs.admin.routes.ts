import { Hono } from "hono";
import { DATA_IMPORT_JOB, jobRunner } from "../../core/jobs/jobRunner.ts";

export const jobsAdminRouter = new Hono()
  .get("/", (c) => c.json(jobRunner.list()))
  .post("/:name/run", (c) => {
    const name = c.req.param("name");

    if (!jobRunner.list().some((job) => job.name === name)) {
      return c.json({ error: "not_found" }, 404);
    }

    // Fire-and-forget: a run may take a while (a full import), so we return
    // immediately and let the client poll GET /jobs for live status and the
    // recorded outcome. Manual data-import uses `fresh` so it always fetches
    // data newer than this request (see jobRunner.runNow). The rejection is
    // already recorded in lastRun and logged by the runner.
    const fresh = name === DATA_IMPORT_JOB;
    jobRunner.runNow(name, { fresh }).catch(() => {});

    return c.body(null, 202);
  });
