import { createRootRoute, Outlet } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { RouteErrorComponent } from "../components/RouteErrorComponent";

export const Route = createRootRoute({
  component: () => (
    <div className="w-screen h-screen">
      <Toaster richColors />
      <Outlet />
    </div>
  ),
  errorComponent: RouteErrorComponent,
});
