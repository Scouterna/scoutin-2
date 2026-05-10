import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SocketLoader } from "../socket/SocketLoader";

export const Route = createFileRoute("/_kiosk")({
  beforeLoad: () => {
    if (!localStorage.getItem("kioskKey")) {
      throw redirect({ to: "/setup" });
    }
  },
  component: RouteComponent,
});

async function loadStyles() {
  await Promise.all([import("../kiosk-styles.css")]);
}

function RouteComponent() {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    loadStyles().finally(() => setLoaded(true));
  }, []);
  if (!loaded) return null;

  return (
    <SocketLoader>
      <Outlet />
    </SocketLoader>
  );
}
