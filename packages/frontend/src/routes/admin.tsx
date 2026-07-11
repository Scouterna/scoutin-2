import CssBaseline from "@mui/material/CssBaseline";
import {
  createFileRoute,
  Outlet,
  redirect,
  useLocation,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api } from "@/api/api";
import { AdminLayout } from "../components/admin/AdminLayout";

export const Route = createFileRoute("/admin")({
  beforeLoad: async ({ location }) => {
    // The login page itself must stay reachable without a session, or an
    // unauthenticated visit would redirect-loop against itself.
    if (location.pathname === "/admin/login") return;

    const res = await api.admin.me.$get();
    if (!res.ok) {
      throw redirect({ to: "/admin/login" });
    }
  },
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
  useEffect(() => {
    loadStyles().finally(() => setLoaded(true));
  }, []);
  if (!loaded) return null;

  // The login page has no session yet, so the nav/logout chrome doesn't
  // apply to it.
  if (pathname === "/admin/login") {
    return (
      <>
        <CssBaseline />
        <Outlet />
      </>
    );
  }

  return (
    <>
      <CssBaseline />

      <AdminLayout>
        <Outlet />
      </AdminLayout>
    </>
  );
}
