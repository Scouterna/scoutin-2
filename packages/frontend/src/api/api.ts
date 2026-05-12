import type { AppType } from "@scouterna/scoutin-backend";
import { hc } from "hono/client";

// this is a trick to calculate the type when compiling: https://hono.dev/docs/guides/rpc#compile-your-code-before-using-it-recommended
export type Client = ReturnType<typeof hc<AppType>>;

export const hcWithType = (...args: Parameters<typeof hc>): Client =>
  hc<AppType>(...args);

const apiUrlRaw = import.meta.env.VITE_API_URL;

if (!apiUrlRaw) {
  throw new Error("VITE_API_URL is not defined");
}

const apiUrl = new URL(apiUrlRaw, window.location.href).href;

export const { api, ws } = hcWithType(apiUrl);
