// biome-ignore assist/source/organizeImports: Sorting seems to mess up some types for some reason.
import { defineConfig } from "vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import svgr from "vite-plugin-svgr";
import babel from "@rolldown/plugin-babel";
import jotaiDebugLabel from "jotai-babel/plugin-debug-label";
import jotaiReactRefresh from "jotai-babel/plugin-react-refresh";
import {
  pluginExternals,
  scoutinPlugins,
  pluginPackages,
} from "./vite-plugins/scoutinPlugins.ts";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    scoutinPlugins(),
    svgr(),
    tanstackRouter({ autoCodeSplitting: true }),
    viteReact(),
    babel({
      presets: [reactCompilerPreset()],
      plugins: [jotaiDebugLabel, jotaiReactRefresh],
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    // Plugin packages export raw TypeScript source — exclude them from
    // pre-bundling so Vite processes them as source files and HMR works.
    exclude: pluginPackages,
  },
  server: {
    fs: {
      // Allow Vite to serve files from the workspace root so plugin sources
      // (which live outside packages/frontend) can be resolved.
      allow: ["../.."],
    },
  },
  build: {
    rollupOptions: {
      external: pluginExternals,
    },
  },
});
