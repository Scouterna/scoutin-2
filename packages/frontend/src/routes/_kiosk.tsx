import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/_kiosk")({
  component: RouteComponent,
});

async function loadStyles() {
  await Promise.all([import("../kiosk-styles.css")]);
}

function RouteComponent() {
  // Only load kiosk CSS when component is mounted
  const [loaded, setLoaded] = useState(false);
  loadStyles().finally(() => setLoaded(true));
  if (!loaded) return null;

  return <Outlet />;
}
