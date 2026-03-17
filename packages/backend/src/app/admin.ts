import { Hono } from "hono";
import { sessionsAdminRouter } from "../domains/sessions/sessions.admin.routes.ts";

export const adminRouter = new Hono().route("/sessions", sessionsAdminRouter);
