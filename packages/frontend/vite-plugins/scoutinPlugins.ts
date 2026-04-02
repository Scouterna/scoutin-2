import type { Plugin } from "vite";
import pluginsJson from "../../backend/plugins.json" with { type: "json" };

/**
 * Rollup externals for all plugin subpaths. Pass this to
 * `build.rollupOptions.external` so that plugin packages are not bundled into
 * the host app — they are loaded separately at runtime via importmap.
 */
export const pluginExternals = pluginsJson.plugins.flatMap((pkg) => [
  `${pkg}/frontend`,
  `${pkg}/backend`,
]);

/**
 * Vite plugin that exposes installed plugins to the frontend via a virtual
 * module (`virtual:scoutin-plugins`).
 *
 * At build/dev time it reads `plugins.json` and generates static ESM imports
 * for each plugin's `/frontend` subpath, then re-exports them as an array:
 *
 *   import { plugin } from '@scouterna/scoutin-plugin-base/frontend';
 *   export default [plugin, ...];
 *
 * Using static imports (rather than dynamic `import()`) means Vite can
 * analyse the module graph, enabling HMR when plugin source files change
 * during development.
 *
 * To add a plugin: add it to `plugins.json` and restart the dev server.
 */
export function scoutinPlugins(): Plugin {
  const virtualId = "virtual:scoutin-plugins";
  const resolvedId = `\0${virtualId}`;
  return {
    name: "scoutin-plugins",
    resolveId: (id) => (id === virtualId ? resolvedId : undefined),
    load(id) {
      if (id !== resolvedId) return;
      const lines = pluginsJson.plugins.flatMap((pkg, i) => [
        `import * as p${i} from '${pkg}/frontend';`,
      ]);
      const arr = pluginsJson.plugins.map((_, i) => `p${i}.plugin`).join(", ");
      return [...lines, `export default [${arr}];`].join("\n");
    },
  };
}
