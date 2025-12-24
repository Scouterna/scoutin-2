// import { TanstackDevtools } from "@tanstack/react-devtools";
import { createRootRoute, Outlet } from "@tanstack/react-router";
// import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { SocketLoader } from "../socket/SocketLoader";

export const Route = createRootRoute({
  component: () => (
    <div className="w-screen h-screen">
      <SocketLoader>
        <Outlet />
        {/* <TanstackDevtools
          config={{
            position: "bottom-left",
          }}
          plugins={[
            {
              name: "Tanstack Router",
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        /> */}
      </SocketLoader>
    </div>
  ),
});
