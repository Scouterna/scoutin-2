import { Hono } from "hono";
import { sessionRouter } from "./api/session/session.routes.ts";
import { stepRouter } from "./api/step/step.routes.ts";

const app = new Hono();

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

const routes = app.route("/session", sessionRouter).route("/step", stepRouter);

export default app;
export type AppType = typeof routes;
