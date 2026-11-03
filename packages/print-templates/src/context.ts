import { AsyncLocalStorage } from "node:async_hooks";

export type RenderFont = {
  name: string;
  weight: number;
  style: "normal" | "italic";
  data: Buffer | ArrayBuffer;
};

export type RenderContext = { fonts: RenderFont[] };

// Kept on globalThis, not in module state: templates are loaded by jiti, which
// can instantiate a second copy of this package (in dev it resolves to source
// outside node_modules). A module-level store would be empty in that copy, so
// whichever copy loads first creates the store and all copies share it.
const KEY = Symbol.for("scouterna.printTemplates.renderContext");

function getStorage(): AsyncLocalStorage<RenderContext> {
  const g = globalThis as { [KEY]?: AsyncLocalStorage<RenderContext> };
  g[KEY] ??= new AsyncLocalStorage<RenderContext>();
  return g[KEY];
}

/** Runs fn with the fonts the template's helpers measure against. */
export function withRenderContext<T>(ctx: RenderContext, fn: () => T): T {
  return getStorage().run(ctx, fn);
}

export function getRenderContext(): RenderContext {
  const ctx = getStorage().getStore();
  if (!ctx) {
    throw new Error(
      "No render context: FitText must be used while a template renders",
    );
  }
  return ctx;
}
