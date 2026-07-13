import Box from "@mui/material/Box";
import CssBaseline from "@mui/material/CssBaseline";
import Typography from "@mui/material/Typography";
import {
  createFileRoute,
  Outlet,
  redirect,
  useLocation,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api } from "@/api/api";
import {
  type AppUser,
  ForbiddenError,
  hasRole,
  UserContext,
} from "@/lib/user-context";
import { AdminLayout } from "../components/admin/AdminLayout";

export const Route = createFileRoute("/admin")({
  beforeLoad: async ({ location }): Promise<{ user: AppUser } | undefined> => {
    // The login page itself must stay reachable without a session, or an
    // unauthenticated visit would redirect-loop against itself.
    if (location.pathname === "/admin/login") return;

    const res = await api.admin.auth.me.$get();
    const { user } = res.ok ? await res.json() : { user: null };

    if (!user) {
      throw redirect({ to: "/admin/login" });
    }
    // Any panel user (operator or admin) may enter; admin-only pages guard
    // themselves (see assertAdmin) and the backend enforces per-route.
    if (!hasRole(user, "admin") && !hasRole(user, "operator")) {
      throw new ForbiddenError();
    }

    return { user };
  },
  errorComponent: AdminErrorComponent,
  component: RouteComponent,
});

async function loadStyles() {
  await Promise.all([
    import("@fontsource/roboto/300.css"),
    import("@fontsource/roboto/400.css"),
    import("@fontsource/roboto/500.css"),
    import("@fontsource/roboto/700.css"),
  ]);
}

function RouteComponent() {
  const [loaded, setLoaded] = useState(false);
  const { pathname } = useLocation();
  const context = Route.useRouteContext();
  useEffect(() => {
    loadStyles().finally(() => setLoaded(true));
  }, []);
  if (!loaded) return null;

  // The login page has no session yet, so the nav/logout chrome doesn't apply.
  if (pathname === "/admin/login") {
    return (
      <>
        <CssBaseline />
        <Outlet />
      </>
    );
  }

  const user = context && "user" in context ? context.user : null;

  return (
    <UserContext.Provider value={user}>
      <CssBaseline />
      <AdminLayout>
        <Outlet />
      </AdminLayout>
    </UserContext.Provider>
  );
}

function CenteredMessage({ title, body }: { title: string; body: string }) {
  return (
    <>
      <CssBaseline />
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          gap: 2,
          p: 3,
          textAlign: "center",
        }}
      >
        <Typography variant="h4" component="h1">
          {title}
        </Typography>
        <Typography variant="body1" color="text.secondary">
          {body}
        </Typography>
      </Box>
    </>
  );
}

function AdminErrorComponent({ error }: { error: Error }) {
  if (error.name === "ForbiddenError") {
    return (
      <CenteredMessage
        title="Du saknar behörighet"
        body="Ditt konto har inte tillgång till administrationsgränssnittet."
      />
    );
  }
  return (
    <CenteredMessage
      title="Något gick fel"
      body="Sidan kunde inte laddas. Försök ladda om."
    />
  );
}
