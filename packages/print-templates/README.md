# @scouterna/scoutin-print-templates

Helpers for badge templates (JSX without React, `FitText`, `Img`, `makeLabel`).

The render context (fonts) lives on `globalThis` under
`Symbol.for("scouterna.printTemplates.renderContext")`, not in module state.
Templates are loaded with jiti, which can instantiate a second copy of this
package next to the one the backend imported; a module-level store would be
empty in that copy.
