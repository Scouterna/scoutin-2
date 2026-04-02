import { createNodeWebSocket } from "@hono/node-ws";
import { prometheus } from "@hono/prometheus";
import { Hono } from "hono";
import { cors } from "hono/cors";
import config from "../config/config.ts";
import { loadAllDataSourcesIntoDatabase } from "../domains/participants/data.service.ts";
import { kiosksRouter } from "../domains/kiosks/kiosks.routes.ts";
import { sessionRouter } from "../domains/sessions/session.routes.ts";
import { router as sessionSocketRouter } from "../domains/sessions/session.socket.ts";
import { stepRouter } from "../domains/workflows/step.routes.ts";
import { loadPlugins } from "../domains/workflows/steps.ts";
import { adminRouter } from "./admin.ts";
import { activeWebSocketConnections, registry } from "./metrics.ts";

// TODO: Move this to a job runner
await loadAllDataSourcesIntoDatabase();

// Load plugins before creating the app
await loadPlugins();

const app = new Hono();

const { printMetrics, registerMetrics } = prometheus({
  registry,
});

app.use("*", registerMetrics);
app.get("/metrics", printMetrics);

if (config.NODE_ENV === "development") {
  app.use("/api/*", cors());
}

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

const routes = app
  .route("/api/session", sessionRouter)
  .route("/api/step", stepRouter)
  .route("/api/admin", adminRouter)
  .route("/api/kiosk", kiosksRouter)
  .get(
    "/ws/session",
    upgradeWebSocket(async (c) => {
      // Simulate delay for testing purposes
      // await new Promise((resolve) => setTimeout(resolve, 1500));

      activeWebSocketConnections.inc();

      return {
        onMessage: sessionSocketRouter.onMessage(c),
        onClose() {
          activeWebSocketConnections.dec();
          console.log("WebSocket connection closed");
        },
      };
    }),
  );

export { app, injectWebSocket };
export type AppType = typeof routes;
