import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { sessionRouter } from "./api/session/session.routes.ts";
import { stepRouter } from "./api/step/step.routes.ts";
import config from "./config.ts";
import { verifyJWT } from "./tokens.ts";

const app = new Hono({});

declare module "hono" {
  interface ContextVariableMap {
    wsAuthenticated?: boolean;
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
    "/ws",
    upgradeWebSocket((c) => ({
      async onMessage(event, ws) {
        const authenticated = c.get("wsAuthenticated") ?? false;

        if (!authenticated) {
          if (!event.data.toString().startsWith("auth:")) {
            ws.close(1000, "Unauthorized");
            return;
          }

          const token = event.data.toString().substring(5);
          const verifiedToken = await verifyJWT(token);

          if (!verifiedToken.valid) {
            ws.close(1000, "Unauthorized");
            return;
          }

          console.log(verifiedToken.payload);

          c.set("wsAuthenticated", true);
        }

        console.log(`Message from client: ${event.data}`);
        ws.send("Hello from server!");
      },
      onClose() {
        console.log("WebSocket connection closed");
      },
    })),
  );

export { app, injectWebSocket };
export type AppType = typeof routes;
