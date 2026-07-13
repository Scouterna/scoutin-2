import type { InferResponseType } from "hono/client";
import { createContext, useContext } from "react";
import type { api } from "@/api/api";

type AuthMeResponse = InferResponseType<typeof api.admin.auth.me.$get>;

/** The authenticated admin user, inferred from the backend's /api/auth/me
 * response so there's no duplicated contract. */
export type AppUser = NonNullable<AuthMeResponse["user"]>;

export const UserContext = createContext<AppUser | null>(null);

export function useUser(): AppUser {
  const user = useContext(UserContext);
  if (!user) {
    throw new Error(
      "useUser must be used inside the authenticated admin layout",
    );
  }
  return user;
}

/** Thrown by a route guard when the user lacks a required role. Caught by the
 * /admin route's errorComponent (matched by name), which shows a no-access page. */
export class ForbiddenError extends Error {
  constructor() {
    super("forbidden");
    this.name = "ForbiddenError";
  }
}

export function hasRole(
  user: AppUser | null | undefined,
  role: string,
): boolean {
  return user?.roles.includes(role) ?? false;
}

/** Pull the user out of a TanStack route context (the /admin beforeLoad puts it
 * there); null when absent (e.g. the login path returns no context). */
function userFromContext(context: unknown): AppUser | null {
  if (context && typeof context === "object" && "user" in context) {
    return (context as { user?: AppUser }).user ?? null;
  }
  return null;
}

/** Route-guard helper: throw ForbiddenError unless the context user is admin. */
export function assertAdmin(context: unknown): void {
  if (!hasRole(userFromContext(context), "admin")) {
    throw new ForbiddenError();
  }
}
