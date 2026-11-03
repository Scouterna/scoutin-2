# Writing badge templates

A template turns a few values (a name, a group) into a full label image for a
printer. This is the short practical guide. The design is in
`printer-proxy-spec.md`.

## Where the files go

Everything lives in `config/templates/` (relative to the backend's working
directory: `packages/backend/config/templates` in dev, the mounted `/app/config`
in production). The directory may be missing; then only the built-in labels exist.

```
config/templates/
  badge.tsx                 one template per top-level .tsx / .ts file
  nametag/nametag.tsx             or a folder template: <name>/<name>.tsx
  nametag/images/logo.svg      its own images, next to it
  calibration@203.png       a static image template, one file per dpi
  calibration@300.png
  images/logo.png           for <Img src="images/logo.png">
  fonts/fonts.yml           extra fonts (optional)
  fonts/Brand-Bold.woff
```

- Names are the file name without the extension (for a folder template, the
  folder name) and must match
  `^[a-z0-9][a-z0-9_-]*$`. `png` and names starting with `_` are reserved for
  built-ins (`_test` shows the printer's name, serial, pool, relay and dpi).
- A top-level directory containing `<name>.tsx` or `<name>.ts` is a folder template
  (see "Folder templates"). Other subdirectories, except `images/` and `fonts/`, are
  free for helper modules your templates import.
- A name can be defined only once: `nametag.tsx` together with `nametag/nametag.tsx` is a
  load problem, reported with the rest.
- Templates are loaded once at startup. Any problem (syntax error, missing default
  export, bad `values`, a PNG that isn't 1-bit, a font that's missing) stops the
  server from starting and lists every problem together. Changing a template
  means restarting, except in development (see "Authoring with the template
  studio").
- **Real brand fonts, logos and templates live only in the runtime-mounted
  `config/templates` and must never be committed to this repo.** The committed
  `example-name-tag.tsx` is neutral and only uses the built-in Roboto.

## The module

```tsx
/** @jsxImportSource @scouterna/scoutin-print-templates */
import { FitText, type Label } from "@scouterna/scoutin-print-templates";
import { type } from "arktype";

export const values = type({ firstName: "string > 0", "group?": "string" });

export default function badge(v: typeof values.infer, label: Label, printer) {
  return (
    <div style={{ display: "flex", width: label.width, height: label.height }}>
      <FitText width={label.width} max={label.pt(40)} min={label.pt(14)}>
        {v.firstName}
      </FitText>
    </div>
  );
}
```

- The default export is a function `(values, label, printer) => element`. `printer`
  has `name`, `serial`, `pool`, `relay`, `dpi`, for labels that describe the printer.
- The named export `values` is an ArkType type. It validates the values when a job
  is created (a bad request is a 400 with the reason), and again at render time.
  Without it, values aren't validated and the server logs a warning at startup.
- JSX is compiled at startup (with jiti) to our own element objects, not React.
  Put `/** @jsxImportSource @scouterna/scoutin-print-templates */` at the top for
  editor types; `/** @jsx h */` with `import { h } ...` works too, and so does a
  file without any pragma.
- Layout is Satori's: flexbox only, `display: "flex"` on anything with several
  children. Satori adds padding and borders to a box's width and height instead
  of taking them from it, so a label-sized box with padding overflows the label.
- The image is the **whole label**: `label.width` by `label.height` dots, at the
  printer's dpi. The same template renders pixel-exact on 203 and 300 dpi
  printers, as long as sizes come from `label.mm()` and `label.pt()`.

## Helpers

- `label.width`, `label.height`, `label.dpi`, `label.mm(n)`, `label.pt(n)`: sizes
  in dots. Use `mm` and `pt` rather than fixed pixels.
- `<>…</>` adds no element: its children become children of the parent, so they
  take part in the parent's flex layout. A fragment at the very root of a
  template is wrapped in a `display: flex` row, since it has no parent.
- `<FitText width max min maxLines? lineClamp? fontFamily? fontWeight?>`: the
  largest size between `max` and `min` that fits `width` on one line. At `min` it
  wraps to `lineClamp` lines and ends in an ellipsis. With `maxLines` it wraps
  first: the largest size at which the text fits in that many lines, so a long
  name takes two lines at a big size instead of one line at a small one. If it
  doesn't fit even at `min`, it ends in an ellipsis after `maxLines` lines.
  `maxLines` wins over `lineClamp`. It also takes `style` and `tw` for things
  like `color`, `textAlign` and margins; what the fitting sets itself (size,
  width, wrapping) wins over those, and `letterSpacing` or `textTransform`
  aren't measured, so avoid them. Newlines in the text (`\n`; write them as
  `\n` in the JSON mode of the values form) are forced line breaks when
  `maxLines` is above 1, and count toward the limit; without `maxLines` (or with
  `lineClamp`) they collapse to spaces as before.
- `<Img src width height? dither?>`: an image from `images/`, resized to exactly
  that size. Without `dither` it's thresholded; with it, Floyd-Steinberg
  dithered (use for photos and gray logos). Transparency is kept, so a white
  logo on a transparent background shows up on a black `div` behind it. SVG
  files work too. A single-file template resolves `src` against the templates
  directory. A folder template looks in its own folder first and then in the
  templates directory. Paths can't leave the directory they are resolved
  against (symlinks included), and files over 2 MB are refused.
- `<QR value size ecc? quiet? minModule? style? tw?>`: a QR code drawn as an
  exact bitmap. `size` is the largest box in dots, quiet zone included; every
  module is a whole number of dots, so the code can end up a little smaller.
  `ecc` is `L`, `M` (default), `Q` or `H`, and `quiet` is the white border in
  modules (default 4, which scanners need). It throws, and the job fails, if a
  module would be under `minModule` dots (default 3) rather than print a code
  that won't scan. It's black on white unless you set `invert`, which gives white
  modules on black (the quiet zone too, so put it on a black area). Phone cameras
  read inverted codes but many scanners don't, so test yours. Put it where it
  lands on whole dots: a half-dot offset (for example from centering an odd
  size) blurs the edges.

## Folder templates

Put a template and its assets in one directory named after it:
`nametag/nametag.tsx` is the template `nametag`, and `<Img src="images/logo.svg">` finds
`nametag/images/logo.svg`. If that file isn't there, the shared
`images/logo.svg` in the templates directory is used. Helper modules next to it
work as usual (relative imports). A folder can also have its own fonts in
`nametag/fonts/fonts.yml` (see "Fonts"). A
directory without `<name>.tsx` or `<name>.ts` inside is not a template. Editing
anything inside the folder reloads in development, and cached renders are
dropped on every reload, so a changed image shows up at once.

## Tailwind classes

Elements accept a `tw` prop with Tailwind classes, handled by Satori (a subset:
flex layout, spacing, colors, borders, text size). Sizes are dots, not
millimeters, so use `style` with `label.mm()` for anything that must keep its
physical size across printers.
For a component that takes a `tw` prop, `cx("flex bg-black", tw)` joins the class
names and skips empty ones; the later class wins on a conflict, so the caller's
classes go last.

```tsx
<div tw="flex flex-col bg-black text-white" style={{ padding: label.mm(4) }}>
```

## Fonts

Roboto 400 and 700 are always there, as the family `Roboto`. More go in
`fonts/fonts.yml`:

```yaml
- { file: Brand-Regular.woff, family: Brand, weight: 400 }
- { file: Brand-Bold.woff, family: Brand, weight: 700, style: normal }
```

`file` is relative to `fonts/`. TTF, OTF and WOFF only. WOFF2 is rejected
because `FitText` measures text with opentype.js, which can't read it. Use
static files: variable fonts render as their default instance only. `style`
defaults to `normal`. An entry with the same family, weight and style as a
built-in replaces it. Use the family in `style.fontFamily` or `fontFamily` on
`FitText`.

A folder template can add fonts that only it can use, in
`<name>/fonts/fonts.yml` (same format, `file` relative to `<name>/fonts/`).
Other templates don't see them, and `FitText` and `fontFamily` find them in
that template only. A template renders with Roboto, then the global
`fonts/fonts.yml`, then its own, and a later entry with the same family, weight
and style replaces an earlier one. Template fonts are checked at load like the
global ones: a missing file or bad manifest is a load problem and the previous
templates stay active. Editing them reloads in development and drops cached
renders.

## Static image templates

`name@dpi.png` is printed exactly as it is: no values, no scaling, placed at the
top left and padded with white to the label size. It must be a 1-bit grayscale PNG
(or one with a 2-color palette). If there's no file for a printer's dpi, or the
image is larger than the label, the job fails with a render error. Use this for
calibration labels.

## Fixed label size

Printers report slightly different label lengths after calibration (2108 or
2114 dots for the same stock), so by default the same template renders on
slightly different canvases. A template can say how big its label is:

```tsx
export const size = { widthMm: 100, lengthMm: 257.5 };
```

- Both sides are optional; a side left out follows the printer's reported value.
  Values are millimeters from 20 to 500, anything else is a load problem. It
  applies to `.tsx` templates (single-file and folder), not to static PNGs.
- Millimeters become dots as `round(mm * dpi / 25.4)`, with 203 dpi counted as
  203.2 (exactly 8 dots per millimeter): 100 mm is 800 dots and 257.5 mm is
  2060. `label.mm()` and `label.pt()` use the same rule.
- The canvas (`label.width` and `label.height`) is the template's size. The
  printer's reported label is the limit: a canvas larger than it fails the job
  with an error like `template "x" is 2060 dots long but the printer's label is
  2000`, so nothing prints past the label edge. A smaller canvas is fine. A
  printer that hasn't reported its size yet still waits, as before.
- The preview always uses the template's size for the sides it fixes. The
  studio locks those inputs (showing the dots at the chosen dpi) and warns when
  the selected printer reports a smaller label. When a template fixes both
  sides, the studio replaces the printer and size inputs with a dpi select and
  an optional "Check against printer" select that marks each printer as fits,
  too small or size not reported.

## What the printer gets

Satori renders to SVG, resvg rasterizes it at native size, and the gray image is
thresholded at **80 of 255** into a 1-bit PNG. 80 and not the midpoint on purpose:
thermal dot gain spreads the black, and 80 keeps small white-on-black text
readable (found by test prints; 128 loses it, 64 warps round letters).

Design rules from the test prints:

- Reverse text (white on black): keep it at 28 px or larger, regular or bold.
  Smaller, thin text closes up.
- Large solid black areas are the hardest thing for the head (heat, banding,
  wear). Prefer a strip over a full black label.
- The whole label is one image: whatever is outside your elements is white.
- Pre-dither photos with `<Img dither>`; text and vectors are already crisp.

## Trying a template

`GET /api/admin/printing/templates` lists the loaded templates, with a JSON
Schema of the values.

`POST /api/admin/printing/templates/:name/preview` renders without creating a job
and answers with `image/png`:

```json
{ "values": { "firstName": "Ada" }, "dpi": 203, "widthDots": 812, "lengthDots": 1218 }
```

`dpi` is 150-600 and the sizes 100-4000. An optional `printer` object
(`name`, `serial`, `pool`, `relay`) fills in the printer context. To print,
`POST /api/admin/printing/jobs/template` with
`{ template, values, copies?, poolId | printerId }`.

## Authoring with the template studio

Development only (`NODE_ENV=development`); none of this exists in production.

- **Live reload.** The backend watches the whole templates directory and reloads
  after a short pause (about 250 ms) following the last change. That covers
  templates, local helper modules they import, `images/` and `fonts/`. Reloads
  never overlap. If the directory doesn't exist yet, the watcher keeps checking
  every 2 seconds. A reload that fails (any load problem) keeps the last working
  templates active and records the problems.
- **Ignored by the watcher:** dotfiles and anything in a dot directory, names
  ending in `~`, `.swp`, `.swx`, `.tmp` or `.orig`, and names that are only digits
  (such as vim's `4913`).
- **Routes**, under `/api/admin/printing/dev` (404 outside development):
  `GET /dev/status` and `POST /dev/reload` both answer
  `{ enabled: true, revision, loadedAt, error, templates }`. `revision` goes up on
  every load attempt, successful or not; `error` is a list of problems, or `null`
  after a good load; `templates` has the same shape as `GET /templates`. A failed
  reload is still HTTP 200, with `error` set.
- **Render stats.** The preview response carries `X-Render-Ms` and
  `X-Black-Percent` (the share of dots that print black, a hint about heat).
- **`sample`.** A template may export example values:
  `export const sample = { firstName: "Ada" };`. It is listed as `sample` in
  `GET /templates` and must fit `values`; if it doesn't, that is a load problem.
- **`size`.** Listed as `size` in `GET /templates` when a template fixes its label
  size (see "Fixed label size"). In the studio, the width and length inputs are
  read-only for the sides it fixes, with the note "Fixed by the template: W x L
  mm"; dpi stays selectable.
