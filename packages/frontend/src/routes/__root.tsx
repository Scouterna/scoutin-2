import { createRootRoute, Outlet } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { SocketLoader } from "../socket/SocketLoader";

export const Route = createRootRoute({
  component: () => (
    <div className="w-screen h-screen">
      <Toaster richColors />
      {/* SocketLoader is used here and not in main.tsx so that the suspense in main.tsx catches it loading. */}
      <SocketLoader>
        <Outlet />
      </SocketLoader>
    </div>
  ),
});
