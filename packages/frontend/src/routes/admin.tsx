import CssBaseline from "@mui/material/CssBaseline";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AdminLayout } from "../components/admin/AdminLayout";

export const Route = createFileRoute("/admin")({
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
  useEffect(() => {
    loadStyles().finally(() => setLoaded(true));
  }, []);
  if (!loaded) return null;

  return (
    <>
      <CssBaseline />

      <AdminLayout>
        <Outlet />
      </AdminLayout>
    </>
  );
}
