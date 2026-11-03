// Routes for the template studio. Always mounted, so the typed client knows
// them, but they answer 404 outside development: they reload code from disk.
import { Hono } from "hono";
import config from "../../config/config.ts";
import type { AppEnv } from "../../core/websocket/types.ts";
import {
  getLoadStatus,
  getTemplatesDir,
  listTemplates,
  loadTemplates,
} from "./templates.service.ts";

function studioState() {
  return {
    enabled: true as const,
    ...getLoadStatus(),
    templates: listTemplates(),
  };
}

export const printingDevRouter = new Hono<AppEnv>()
  .use(async (c, next) => {
    if (config.NODE_ENV !== "development") return c.notFound();
    await next();
  })
  .get("/status", (c) => c.json(studioState()))
  // A broken template is a result here, not an error: the studio shows the
  // problems and keeps the last working version.
  .post("/reload", async (c) => {
    await loadTemplates(getTemplatesDir()).catch(() => undefined);
    return c.json(studioState());
  });
