// biome-ignore assist/source/organizeImports: Sorting seems to mess up some types for some reason.
import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import svgr from "vite-plugin-svgr";
import jotaiDebugLabel from "jotai-babel/plugin-debug-label";
import jotaiReactRefresh from "jotai-babel/plugin-react-refresh";
import { pluginExternals, scoutinPlugins } from "./vite-plugins/scoutinPlugins.ts";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    scoutinPlugins(),
    svgr(),
    tanstackRouter({ autoCodeSplitting: true }),
    viteReact({
      babel: {
        plugins: [
          ["babel-plugin-react-compiler"],
          jotaiDebugLabel,
          jotaiReactRefresh,
        ],
      },
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      external: pluginExternals,
    },
  },
});
