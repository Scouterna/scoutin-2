import type { AppType } from "@scouterna/scoutin-backend";
import { hc } from "hono/client";

export const { api, ws } = hc<AppType>("http://localhost:3000");
