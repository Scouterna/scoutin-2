import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { sessionRouter } from "./api/session/session.routes.ts";
import { stepRouter } from "./api/step/step.routes.ts";
import config from "./config.ts";
import { router as sessionSocketRouter } from "./socket/session/session.socket.ts";

const app = new Hono({});

declare module "hono" {
  interface ContextVariableMap {
    wsSessionId?: string;
  }
}

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
  .get(
    "/ws/session",
    upgradeWebSocket(async (c) => {
      // Simulate delay for testing purposes
      // await new Promise((resolve) => setTimeout(resolve, 1500));

      return {
        onMessage: sessionSocketRouter.onMessage(c),
        onClose() {
          console.log("WebSocket connection closed");
        },
      };
    }),
  );

export { app, injectWebSocket };
export type AppType = typeof routes;
