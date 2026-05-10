import { serve } from "@hono/node-server";
import config, { loadConfig } from "./config/config.ts";

loadConfig();

async function main() {
  // Use dynamic import to make sure config is loaded before app is imported
  const { app, injectWebSocket } = await import("./app/app.ts");

  const server = serve(
    {
      fetch: app.fetch,
      port: config.PORT,
      hostname: "0.0.0.0",
    },
    (info) => {
      console.log(`Server is running on http://localhost:${info.port}`);
    },
  );

  injectWebSocket(server);
}

await main();
