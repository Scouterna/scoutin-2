import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { Provider as StoreProvider } from "jotai";
import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { queryClient } from "./lib/queryClient.ts";
import { loadPlugins } from "./plugins/loadPlugins.ts";
import reportWebVitals from "./reportWebVitals.ts";
import { routeTree } from "./routeTree.gen";
import { store } from "./store/store";

loadPlugins();

// Create a new router instance
const router = createRouter({
  routeTree,
  context: {},
  defaultPreload: "intent",
  scrollRestoration: true,
  defaultStructuralSharing: true,
  defaultPreloadStaleTime: 0,
});

// Register the router instance for type safety
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// Render the app
const rootElement = document.getElementById("app");
if (rootElement && !rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <StrictMode>
      <StoreProvider store={store}>
        {/* <JotaiDevTools /> */}

        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </StoreProvider>
    </StrictMode>,
  );
}

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
