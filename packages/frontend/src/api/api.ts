import type { AppType } from "@scouterna/scoutin-backend";
import { hc } from "hono/client";

// this is a trick to calculate the type when compiling: https://hono.dev/docs/guides/rpc#compile-your-code-before-using-it-recommended
export type Client = ReturnType<typeof hc<AppType>>;

export const hcWithType = (...args: Parameters<typeof hc>): Client =>
  hc<AppType>(...args);

export const { api, ws } = hcWithType("http://localhost:3000");
