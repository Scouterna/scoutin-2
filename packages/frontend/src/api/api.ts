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

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

// Redirect to login when a guarded admin request comes back 401 (e.g. the admin
// session cookie expired mid-session). Scoped to /api/admin/* so the kiosk/
// session endpoints - which authenticate with bearer tokens and have their own
// 401 handling - are left untouched. The /api/admin/auth/* endpoints (login
// etc.) are excluded: a wrong-password 401 there is handled inline, not by
// bouncing the login page.
const authAwareFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  const url = requestUrl(input);
  if (
    res.status === 401 &&
    url.includes("/api/admin/") &&
    !url.includes("/api/admin/auth/")
  ) {
    void import("@/lib/auth-redirect").then((m) => m.redirectToLogin());
  }
  return res;
};

// credentials: "include" so the admin session cookie is sent - harmless for
// the kiosk/session endpoints, which don't use cookies at all.
export const { api, ws } = hcWithType(apiUrl, {
  init: { credentials: "include" },
  fetch: authAwareFetch,
});
