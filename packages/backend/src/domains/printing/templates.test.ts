import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { Hono } from "hono";
import sharp from "sharp";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const cfg = vi.hoisted(() => ({ NODE_ENV: "development" }));
vi.mock("../../config/config.ts", () => ({ default: cfg }));
const createJobs = vi.fn(async (jobs: unknown[]) =>
  jobs.map((_, i) => ({ id: `job-${i}`, state: "queued" })),
);
vi.mock("../../app/prisma.ts", () => ({ prisma: {} }));
vi.mock("../../core/logging/logger.ts", () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { logger: log, getLogger: () => log };
});
vi.mock("../audit/audit.service.ts", () => ({ recordAudit: vi.fn() }));
vi.mock("./dispatch.service.ts", () => ({ dispatch: vi.fn() }));
vi.mock("./relay.socket.ts", () => ({
  printerAction: vi.fn(),
  relayAction: vi.fn(),
  RelayActionError: class extends Error {},
}));
vi.mock("./printers.service.ts", () => ({}));
vi.mock("./jobs.service.ts", () => ({
  createJobs,
  JOB_STATES: ["queued"],
}));

const { encode1bitPng } = await import("./render.ts");
const { renderCache, renderJob, LruCache } = await import("./render-job.ts");
const {
  getFonts,
  getLoadStatus,
  getTemplate,
  isEditorTempFile,
  listTemplates,
  loadTemplates,
  startTemplateWatcher,
  stopTemplateWatcher,
  TemplateLoadError,
  TEST_TEMPLATE,
  templateHash,
  validateValues,
} = await import("./templates.service.ts");
const { printingAdminRouter } = await import("./printing.admin.routes.ts");

// Fixtures live under the backend's node_modules so that "import ... from
// @scouterna/scoutin-print-templates" resolves, as it does from config/.
const BACKEND = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const EXAMPLE_DIR = join(BACKEND, "config", "templates");
let root: string;
let counter = 0;

beforeAll(async () => {
  await mkdir(join(BACKEND, "node_modules", ".cache"), { recursive: true });
  root = await mkdtemp(join(BACKEND, "node_modules", ".cache", "tpl-"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function fixture(files: Record<string, string | Buffer>) {
  const dir = join(root, `case${counter++}`);
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, name)), { recursive: true });
    await writeFile(join(dir, name), content);
  }
  return dir;
}

async function loadError(dir: string): Promise<string[]> {
  try {
    await loadTemplates(dir);
  } catch (err) {
    expect(err).toBeInstanceOf(TemplateLoadError);
    return (err as InstanceType<typeof TemplateLoadError>).problems;
  }
  throw new Error("expected loadTemplates to throw");
}

function decode(png: Buffer) {
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  let off = 8;
  const idat: Buffer[] = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    if (png.toString("latin1", off + 4, off + 8) === "IDAT") {
      idat.push(png.subarray(off + 8, off + 8 + len));
    }
    off += len + 12;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = Math.ceil(w / 8);
  const px = (x: number, y: number) =>
    ((raw[y * (stride + 1) + 1 + (x >> 3)] as number) >> (7 - (x & 7))) & 1;
  return { w, h, depth: png[24], color: png[25], px };
}

const printer = {
  name: "Desk 3",
  serial: "D8J123",
  pool: "Front",
  relay: "Pi 1",
  dpi: 203,
  widthDots: 400,
  lengthDots: 300,
};

const VALID_TSX = `/** @jsxImportSource @scouterna/scoutin-print-templates */
import { FitText } from "@scouterna/scoutin-print-templates";
import { type } from "arktype";
export const values = type({ name: "string" });
export default (v: { name: string }, label: { width: number; height: number }) => (
  <div style={{ display: "flex", width: label.width, height: label.height, backgroundColor: "black" }}>
    <FitText width={label.width} max={60} min={20} fontFamily="Inter" fontWeight={700}>{v.name}</FitText>
  </div>
);
`;

function whitePng(w: number, h: number) {
  return encode1bitPng(new Uint8Array(w * h).fill(255), w, h);
}

describe("loadTemplates", () => {
  it("accepts a missing directory", async () => {
    await loadTemplates(join(root, "does-not-exist"));
    expect(listTemplates().map((t) => t.name)).toEqual([TEST_TEMPLATE]);
  });

  it("loads a tsx template with the automatic JSX pragma and renders it", async () => {
    await loadTemplates(await fixture({ "tag.tsx": VALID_TSX }));
    const info = listTemplates().find((t) => t.name === "tag");
    expect(info?.kind).toBe("tsx");
    expect(info?.valuesSchema).toBeDefined();
    // FitText reads the render context shared through globalThis.
    const out = await renderJob({
      template: "tag",
      values: { name: "Ada" },
      printer,
    });
    const d = decode(out.png);
    expect([d.w, d.h, d.depth]).toEqual([400, 300, 1]);
  });

  it("loads a template with no pragma at all", async () => {
    const src = VALID_TSX.replace(/^\/\*\*.*\*\/\n/, "");
    await loadTemplates(await fixture({ "plain.tsx": src }));
    const out = await renderJob({
      template: "plain",
      values: { name: "Ada" },
      printer,
    });
    expect(out.width).toBe(400);
  });

  it("loads a template with a classic @jsx pragma", async () => {
    const src = `/** @jsx h */
import { h, FitText } from "@scouterna/scoutin-print-templates";
export default (v: { name: string }) => (
  <div style={{ display: "flex", width: 100, height: 100 }}>
    <FitText width={100} max={30} min={10}>x</FitText>
  </div>
);
`;
    await loadTemplates(await fixture({ "classic.tsx": src }));
    expect(getTemplate("classic")?.kind).toBe("tsx");
  });

  it("warns when values is missing and doesn't validate", async () => {
    const warn = vi.fn();
    const dir = await fixture({
      "novalues.ts": `export default () => ({ type: "div", props: {} });`,
    });
    await loadTemplates(dir, { warn });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("novalues.ts"));
    expect(validateValues("novalues", { anything: 1 }).ok).toBe(true);
  });

  it("reports a missing default export, a syntax error and a bad values export together", async () => {
    const dir = await fixture({
      "nodefault.ts": `export const x = 1;`,
      "broken.tsx": `export default function ( {`,
      "badvalues.ts": `export const values = { not: "arktype" };\nexport default () => ({ type: "div", props: {} });`,
      "Bad Name.tsx": VALID_TSX,
      "png.tsx": VALID_TSX,
      "_hidden.tsx": VALID_TSX,
    });
    const problems = await loadError(dir);
    const text = problems.join("\n");
    expect(text).toContain(
      "nodefault.ts: the default export must be a function",
    );
    expect(text).toContain("broken.tsx: could not be loaded");
    expect(text).toContain('badvalues.ts: "values" must be an ArkType type');
    expect(text).toContain("Bad Name.tsx");
    expect(text).toContain("png.tsx: the name");
    expect(text).toContain("_hidden.tsx: the name");
    expect(problems).toHaveLength(6);
  });

  it("keeps the previous registry when loading fails", async () => {
    await loadTemplates(await fixture({ "keep.tsx": VALID_TSX }));
    await loadError(await fixture({ "x.ts": "export const y = 1;" }));
    expect(getTemplate("keep")).toBeDefined();
  });

  describe("static templates", () => {
    it("loads valid 1-bit PNGs per dpi and lists the dpis", async () => {
      await loadTemplates(
        await fixture({
          "calibration@203.png": whitePng(100, 50),
          "calibration@300.png": whitePng(150, 75),
        }),
      );
      const info = listTemplates().find((t) => t.name === "calibration");
      expect(info).toMatchObject({ kind: "static", dpis: [203, 300] });
      expect(templateHash("calibration")).toMatch(/^[0-9a-f]{64}$/);
    });

    it("rejects a PNG that isn't 1-bit", async () => {
      const png8 = await sharp({
        create: {
          width: 10,
          height: 10,
          channels: 3,
          background: { r: 9, g: 9, b: 9 },
        },
      })
        .png()
        .toBuffer();
      const problems = await loadError(
        await fixture({ "color@203.png": png8, "text@203.png": "nope" }),
      );
      expect(
        problems.some((p) => p.startsWith("color@203.png: bit depth 8")),
      ).toBe(true);
      expect(
        problems.some((p) => p.startsWith("text@203.png: not a PNG")),
      ).toBe(true);
    });

    it("accepts a 2-color palette PNG", async () => {
      const two = Uint8Array.from({ length: 100 }, (_, i) => (i % 2 ? 255 : 0));
      const png = await sharp(encode1bitPng(two, 10, 10))
        .png({ palette: true, colours: 2 })
        .toBuffer();
      await loadTemplates(await fixture({ "pal@203.png": png }));
      expect(getTemplate("pal")?.kind).toBe("static");
    });

    it("fails a static template with the same name as a tsx", async () => {
      const problems = await loadError(
        await fixture({ "dup.tsx": VALID_TSX, "dup@203.png": whitePng(8, 8) }),
      );
      expect(problems.join()).toContain("also a static image template");
    });
  });

  describe("fonts manifest", () => {
    // A tiny file with a WOFF header: loading doesn't parse the font.
    const woff = Buffer.concat([Buffer.from("wOFF"), Buffer.alloc(60)]);

    it("loads a valid manifest", async () => {
      await loadTemplates(
        await fixture({
          "fonts/fonts.yml": "- { file: a.woff, family: Brand, weight: 700 }\n",
          "fonts/a.woff": woff,
        }),
      );
      expect(getFonts().map((f) => `${f.name}/${f.weight}`)).toEqual(
        expect.arrayContaining(["Inter/400", "Inter/700", "Brand/700"]),
      );
    });

    it("reports a missing file, a bad weight and WOFF2", async () => {
      const problems = await loadError(
        await fixture({
          "fonts/fonts.yml": [
            "- { file: gone.woff, family: A, weight: 400 }",
            "- { file: b.woff, family: B, weight: 1000 }",
          ].join("\n"),
        }),
      );
      expect(problems.join("\n")).toContain("fonts/fonts.yml");
      const p2 = await loadError(
        await fixture({
          "fonts/fonts.yml": [
            "- { file: gone.woff, family: A, weight: 400 }",
            "- { file: c.woff2, family: C, weight: 400 }",
          ].join("\n"),
        }),
      );
      expect(
        p2.some((p) => p.includes("gone.woff") && p.includes("not found")),
      ).toBe(true);
      expect(p2.some((p) => p.includes("WOFF2"))).toBe(true);
    });
  });
});

describe("validateValues", () => {
  it("accepts and rejects", async () => {
    await loadTemplates(await fixture({ "tag.tsx": VALID_TSX }));
    expect(validateValues("tag", { name: "Ada" })).toEqual({
      ok: true,
      values: { name: "Ada" },
    });
    const bad = validateValues("tag", { name: 3 });
    expect(bad.ok).toBe(false);
    expect(bad.ok === false && bad.error).toContain("name");
    expect(validateValues("nope", {}).ok).toBe(false);
  });
});

describe("built-in _test label", () => {
  it("renders a 1-bit PNG of the label size with a border", async () => {
    await loadTemplates(join(root, "none"));
    const out = await renderJob({
      template: TEST_TEMPLATE,
      values: {},
      printer,
    });
    const d = decode(out.png);
    expect([d.w, d.h, d.depth, d.color]).toEqual([400, 300, 1, 0]);
    // 0 is black. The 6-dot border is on every edge.
    for (const [x, y] of [
      [0, 0],
      [399, 299],
      [200, 0],
      [200, 5],
      [0, 150],
      [5, 150],
      [399, 150],
    ] as const) {
      expect(d.px(x, y), `${x},${y}`).toBe(0);
    }
  });
});

describe("renderJob", () => {
  it("pads a static template to the label size at the top left", async () => {
    const png = encode1bitPng(new Uint8Array(40 * 20), 40, 20); // all black
    await loadTemplates(await fixture({ "cal@203.png": png }));
    const out = await renderJob({ template: "cal", values: {}, printer });
    const d = decode(out.png);
    expect([d.w, d.h]).toEqual([400, 300]);
    expect(d.px(0, 0)).toBe(0);
    expect(d.px(39, 19)).toBe(0);
    expect(d.px(40, 0)).toBe(1);
    expect(d.px(0, 20)).toBe(1);
    expect(d.px(399, 299)).toBe(1);
  });

  it("fails a static template larger than the label", async () => {
    await loadTemplates(await fixture({ "big@203.png": whitePng(500, 20) }));
    await expect(
      renderJob({ template: "big", values: {}, printer }),
    ).rejects.toThrow(/larger than the label/);
  });

  it("fails a static template with no file for the dpi", async () => {
    await loadTemplates(await fixture({ "cal@300.png": whitePng(10, 10) }));
    const err = await renderJob({
      template: "cal",
      values: {},
      printer,
    }).catch((e) => e);
    expect(err.message).toContain('"cal"');
    expect(err.message).toContain("203 dpi");
  });

  it("fails a template whose values no longer fit", async () => {
    await loadTemplates(await fixture({ "tag.tsx": VALID_TSX }));
    await expect(
      renderJob({ template: "tag", values: { name: 1 }, printer }),
    ).rejects.toThrow(/values don't fit/);
  });

  it("fails an unknown template", async () => {
    await expect(
      renderJob({ template: "ghost", values: {}, printer }),
    ).rejects.toThrow(/unknown template/);
  });

  it("leaves the png template alone", async () => {
    const png = whitePng(16, 8);
    const out = await renderJob({
      template: "png",
      values: { png: png.toString("base64") },
      // Sizes don't matter for png.
      printer: { ...printer, widthDots: 1, lengthDots: 1 },
    });
    expect([out.width, out.height]).toEqual([16, 8]);
  });

  it("caches renders per job and printer size", async () => {
    await loadTemplates(await fixture({ "tag.tsx": VALID_TSX }));
    renderCache.clear();
    const a = await renderJob({
      template: "tag",
      values: { name: "A" },
      printer,
      jobId: "j1",
    });
    const b = await renderJob({
      template: "tag",
      values: { name: "A" },
      printer,
      jobId: "j1",
    });
    expect(b).toBe(a);
    const c = await renderJob({
      template: "tag",
      values: { name: "A" },
      printer: { ...printer, dpi: 300, widthDots: 600 },
      jobId: "j1",
    });
    expect(c).not.toBe(a);
    expect(renderCache.size).toBe(2);
  });
});

describe("LruCache", () => {
  it("evicts the least recently used entry", () => {
    const c = new LruCache<number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.get("a");
    c.set("c", 3);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
    expect(c.get("c")).toBe(3);
    expect(c.size).toBe(2);
  });
});

describe("the example template", () => {
  it("loads and renders at 203 and 300 dpi", async () => {
    await loadTemplates(EXAMPLE_DIR);
    expect(getTemplate("example-name-tag")?.kind).toBe("tsx");
    const values = {
      firstName: "Ada",
      lastName: "Lovelace",
      group: "A very long group name that needs more than one line to fit",
    };
    const at = (dpi: number, w: number, l: number) =>
      renderJob({
        template: "example-name-tag",
        values,
        printer: { ...printer, dpi, widthDots: w, lengthDots: l },
      });
    const a = await at(203, 406, 305);
    const b = await at(300, 600, 450);
    expect([a.width, a.height]).toEqual([406, 305]);
    expect([b.width, b.height]).toEqual([600, 450]);
    const d = decode(a.png);
    expect(d.px(5, 5)).toBe(0); // the black strip
    const schema = listTemplates().find(
      (t) => t.name === "example-name-tag",
    )?.valuesSchema;
    expect(JSON.stringify(schema)).toContain("firstName");
  });
});

describe("admin template routes", () => {
  const app = new Hono()
    .use(async (c, next) => {
      (c as never as { set: (k: string, v: unknown) => void }).set("user", {
        sub: "u1",
        username: "tester",
      });
      await next();
    })
    .route("/", printingAdminRouter);
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const POOL = "5b0f1a0e-3a53-4f0b-8f4d-2f3f0f4f6a11";

  beforeAll(async () => {
    await loadTemplates(EXAMPLE_DIR);
  });

  it("lists templates", async () => {
    // A temp directory: the real one holds whatever local templates exist.
    await loadTemplates(
      await fixture({ "alpha.tsx": VALID_TSX, "beta/beta.tsx": VALID_TSX }),
    );
    try {
      const res = await app.request("/templates");
      const body = (await res.json()) as { templates: { name: string }[] };
      expect(body.templates.map((t) => t.name)).toEqual([
        "_test",
        "alpha",
        "beta",
      ]);
    } finally {
      await loadTemplates(EXAMPLE_DIR);
    }
  });

  it("rejects invalid values, unknown templates and png", async () => {
    createJobs.mockClear();
    let res = await post("/jobs/template", {
      template: "example-name-tag",
      values: { lastName: "x" },
      poolId: POOL,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain(
      "firstName",
    );
    res = await post("/jobs/template", {
      template: "ghost",
      values: {},
      poolId: POOL,
    });
    expect(res.status).toBe(400);
    res = await post("/jobs/template", {
      template: "png",
      values: {},
      poolId: POOL,
    });
    expect(res.status).toBe(400);
    expect(createJobs).not.toHaveBeenCalled();
  });

  it("creates the jobs for valid values", async () => {
    createJobs.mockClear();
    const res = await post("/jobs/template", {
      template: "example-name-tag",
      values: { firstName: "Ada" },
      copies: 2,
      poolId: POOL,
    });
    expect(res.status).toBe(201);
    expect(createJobs).toHaveBeenCalledOnce();
    const jobs = createJobs.mock.calls[0]?.[0] as {
      template: string;
      source: string;
    }[];
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      template: "example-name-tag",
      source: "admin",
    });
  });

  it("previews as image/png and limits the size", async () => {
    let res = await post("/templates/example-name-tag/preview", {
      values: { firstName: "Ada" },
      dpi: 203,
      widthDots: 406,
      lengthDots: 305,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const png = Buffer.from(await res.arrayBuffer());
    expect(png.readUInt32BE(16)).toBe(406);
    res = await post("/templates/example-name-tag/preview", {
      values: { firstName: "Ada" },
      dpi: 203,
      widthDots: 90000,
      lengthDots: 305,
    });
    expect(res.status).toBe(400);
    res = await post("/templates/example-name-tag/preview", {
      values: {},
      dpi: 203,
      widthDots: 406,
      lengthDots: 305,
    });
    expect(res.status).toBe(400);
  });
});

// A template whose color comes from a helper module: the black share of the
// render says which version of the helper was used.
const helperTemplate = (color: string) => ({
  "tpl.tsx": `import { h } from "@scouterna/scoutin-print-templates";
import { fill } from "./lib/helper.ts";
export default (_v: unknown, label: { width: number; height: number }) =>
  h("div", { style: { display: "flex", width: label.width, height: label.height, backgroundColor: fill } });
`,
  "lib/helper.ts": `export const fill = "${color}";\n`,
});

async function blackPercent(name: string) {
  const out = await renderJob({ template: name, values: {}, printer });
  return out.stats?.blackPercent;
}

async function until(check: () => boolean | Promise<boolean>, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("timed out waiting for the condition");
}

// A template that fills the label with images/mark.svg: the black share of
// the render says which image was found.
const IMG_TEMPLATE = `import { h, Img } from "@scouterna/scoutin-print-templates";
export default (_v: unknown, label: { width: number; height: number }) =>
  h("div", { style: { display: "flex", width: label.width, height: label.height, backgroundColor: "white" } },
    Img({ src: "images/mark.svg", width: label.width, height: label.height }));
`;
const svg = (fill: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="${fill}"/></svg>`;

describe("folder templates", () => {
  it("loads <name>/<name>.tsx and renders it", async () => {
    await loadTemplates(
      await fixture({
        "tag/tag.tsx": VALID_TSX,
        "other/tag2.ts": "export const x = 1;",
      }),
    );
    expect(listTemplates().find((t) => t.name === "tag")).toMatchObject({
      name: "tag",
      kind: "tsx",
    });
    const out = await renderJob({
      template: "tag",
      values: { name: "Ada" },
      printer,
    });
    expect([out.width, out.height]).toEqual([400, 300]);
  });

  it("loads <name>/<name>.ts too", async () => {
    await loadTemplates(
      await fixture({
        "nv/nv.ts": `export default () => ({ type: "div", props: {} });`,
      }),
    );
    expect(getTemplate("nv")?.kind).toBe("tsx");
  });

  it("resolves Img in its own folder first, then in the root", async () => {
    await loadTemplates(
      await fixture({
        "own/own.tsx": IMG_TEMPLATE,
        "own/images/mark.svg": svg("black"),
        "shared/shared.tsx": IMG_TEMPLATE,
        "flat.tsx": IMG_TEMPLATE,
        "images/mark.svg": svg("white"),
      }),
    );
    // The square image is fit into the label, so not all of it is black.
    expect(await blackPercent("own")).toBeGreaterThan(50);
    // No image in its folder: the root one is used.
    expect(await blackPercent("shared")).toBe(0);
    // A single-file template never looks in a folder.
    expect(await blackPercent("flat")).toBe(0);
  });

  it("keeps single-file templates on the root even if a folder has the image", async () => {
    await loadTemplates(
      await fixture({
        "flat.tsx": IMG_TEMPLATE,
        "flat/images/mark.svg": svg("black"),
        "images/mark.svg": svg("white"),
      }),
    );
    expect(await blackPercent("flat")).toBe(0);
  });

  it("reports a name defined twice together with other problems", async () => {
    const problems = await loadError(
      await fixture({
        "dup.tsx": VALID_TSX,
        "dup/dup.tsx": VALID_TSX,
        "bad/bad.ts": "export const y = 1;",
        "both/both.ts": "export default () => 1;",
        "both/both.tsx": VALID_TSX,
      }),
    );
    const text = problems.join("\n");
    expect(text).toContain('already defines "dup"');
    expect(text).toContain("bad/bad.ts: the default export must be a function");
    expect(text).toContain('also defines "both"');
  });

  it("applies the name rules to the folder name", async () => {
    const problems = await loadError(
      await fixture({
        "_hid/_hid.tsx": VALID_TSX,
        "Bad Name/Bad Name.tsx": VALID_TSX,
      }),
    );
    expect(problems.join("\n")).toContain("_hid/_hid.tsx: the name");
    expect(problems.join("\n")).toContain("Bad Name");
    expect(problems).toHaveLength(2);
  });

  it("doesn't treat a directory without <name>.tsx as a template", async () => {
    await loadTemplates(
      await fixture({
        // Not named after the folder, so it is just a module.
        "lib/index.tsx": VALID_TSX,
        "Not A Name/helper.ts": "export const x = 1;",
        "images/logo.svg": svg("black"),
        "fonts/fonts.yml": "[]\n",
        "tag.tsx": VALID_TSX,
      }),
    );
    expect(listTemplates().map((t) => t.name)).toEqual(["_test", "tag"]);
  });

  it("refuses paths that leave the folder or the templates directory", async () => {
    const dir = await fixture({
      "own/own.tsx": IMG_TEMPLATE.replace(
        "images/mark.svg",
        "../images/mark.svg",
      ),
      "images/mark.svg": svg("black"),
      "esc/esc.tsx": IMG_TEMPLATE.replace(
        "images/mark.svg",
        "../../outside.svg",
      ),
      "link/link.tsx": IMG_TEMPLATE,
      "link/images/.keep": "",
    });
    await writeFile(join(dir, "..", "outside.svg"), svg("black"));
    await symlink(
      join(dir, "..", "outside.svg"),
      join(dir, "link", "images", "mark.svg"),
    );
    await loadTemplates(dir);
    for (const name of ["own", "esc", "link"]) {
      await expect(
        renderJob({ template: name, values: {}, printer }),
        name,
      ).rejects.toThrow(/leaves the templates directory/);
    }
  });

  it("never serves a stale render after an image in a folder changes", async () => {
    const dir = await fixture({
      "own/own.tsx": IMG_TEMPLATE,
      "own/images/mark.svg": svg("white"),
    });
    await loadTemplates(dir);
    renderCache.clear();
    const args = { template: "own", values: {}, printer, jobId: "folder-1" };
    expect((await renderJob(args)).stats?.blackPercent).toBe(0);
    await writeFile(join(dir, "own", "images", "mark.svg"), svg("black"));
    await loadTemplates(dir);
    expect((await renderJob(args)).stats?.blackPercent).toBeGreaterThan(50);
  });

  describe("fonts of its own", () => {
    afterEach(() => stopTemplateWatcher());

    // A real, parseable font is needed because FitText measures with it.
    const INTER = join(
      dirname(fileURLToPath(import.meta.url)),
      "assets",
      "fonts",
    );
    const regular = () => readFile(join(INTER, "inter-latin-400-normal.woff"));
    const bold = () => readFile(join(INTER, "inter-latin-700-normal.woff"));
    const tpl = (family: string, weight = 400) =>
      VALID_TSX.replace('fontFamily="Inter"', `fontFamily="${family}"`).replace(
        "fontWeight={700}",
        `fontWeight={${weight}}`,
      );
    const names = (t: string) =>
      getFonts(t).map((f) => `${f.name}/${f.weight}/${f.style}`);

    it("are usable in that template only", async () => {
      await loadTemplates(
        await fixture({
          "brand/brand.tsx": tpl("Local"),
          "brand/fonts/fonts.yml":
            "- { file: l.woff, family: Local, weight: 400 }\n",
          "brand/fonts/l.woff": await regular(),
          "plain/plain.tsx": tpl("Local"),
          "single.tsx": tpl("Local"),
        }),
      );
      expect(names("brand")).toContain("Local/400/normal");
      expect(names("brand")).toContain("Inter/700/normal");
      expect(names("plain")).not.toContain("Local/400/normal");
      expect(names("single")).not.toContain("Local/400/normal");
      expect(getFonts().some((f) => f.name === "Local")).toBe(false);

      const ok = await renderJob({
        template: "brand",
        values: { name: "Ada" },
        printer,
      });
      expect([ok.width, ok.height]).toEqual([400, 300]);
      for (const other of ["plain", "single"]) {
        await expect(
          renderJob({ template: other, values: { name: "Ada" }, printer }),
        ).rejects.toThrow('no font "Local" loaded');
      }
    });

    it("override a global font of the same family, weight and style", async () => {
      const dir = await fixture({
        "fonts/fonts.yml": "- { file: g.woff, family: Brand, weight: 400 }\n",
        "fonts/g.woff": await bold(),
        "own/own.tsx": tpl("Brand"),
        "own/fonts/fonts.yml":
          "- { file: l.woff, family: Brand, weight: 400 }\n" +
          "- { file: r.woff, family: Inter, weight: 700 }\n",
        "own/fonts/l.woff": await regular(),
        "own/fonts/r.woff": await regular(),
        "other/other.tsx": tpl("Brand"),
      });
      await loadTemplates(dir);
      const data = (t: string, family: string, weight: number) =>
        getFonts(t).find((f) => f.name === family && f.weight === weight)
          ?.data as Buffer;
      const count = (t: string) =>
        getFonts(t).filter((f) => f.name === "Brand" && f.weight === 400)
          .length;
      expect(count("own")).toBe(1);
      expect(data("own", "Brand", 400).equals(await regular())).toBe(true);
      expect(data("other", "Brand", 400).equals(await bold())).toBe(true);
      // A built-in is replaced too, for that template only.
      expect(data("own", "Inter", 700).equals(await regular())).toBe(true);
      expect(data("other", "Inter", 700).equals(await bold())).toBe(true);
    });

    it("leave the global fonts working in the template", async () => {
      await loadTemplates(
        await fixture({
          "fonts/fonts.yml": "- { file: g.woff, family: Glob, weight: 400 }\n",
          "fonts/g.woff": await regular(),
          "own/own.tsx": tpl("Glob"),
          "own/fonts/fonts.yml":
            "- { file: l.woff, family: Local, weight: 400 }\n",
          "own/fonts/l.woff": await regular(),
        }),
      );
      expect(names("own")).toEqual(
        expect.arrayContaining(["Glob/400/normal", "Local/400/normal"]),
      );
      const out = await renderJob({
        template: "own",
        values: { name: "Ada" },
        printer,
      });
      expect(out.width).toBe(400);
    });

    it("report a bad or missing manifest with the other problems", async () => {
      const problems = await loadError(
        await fixture({
          "a/a.tsx": VALID_TSX,
          "a/fonts/fonts.yml":
            "- { file: gone.woff, family: A, weight: 400 }\n",
          "b/b.tsx": VALID_TSX,
          "b/fonts/fonts.yml": "- { file: x.woff, family: B, weight: 1000 }\n",
          "c/c.tsx": VALID_TSX,
          "c/fonts/fonts.yml":
            "- { file: ../x.woff, family: C, weight: 400 }\n",
          "broken.tsx": "export default 1;",
        }),
      );
      const all = problems.join("\n");
      expect(all).toContain("a/fonts/fonts.yml (gone.woff): file not found");
      expect(all).toContain("b/fonts/fonts.yml");
      expect(all).toContain("c/fonts/fonts.yml (../x.woff)");
      expect(all).toContain("broken.tsx");
    });

    it("keep the previous registry when a template font breaks", async () => {
      const dir = await fixture({
        "own/own.tsx": VALID_TSX,
        "own/fonts/fonts.yml": "[]\n",
      });
      await loadTemplates(dir);
      const before = getTemplate("own");
      await writeFile(
        join(dir, "own", "fonts", "fonts.yml"),
        "- { file: gone.woff, family: A, weight: 400 }\n",
      );
      await expect(loadTemplates(dir)).rejects.toBeInstanceOf(
        TemplateLoadError,
      );
      expect(getTemplate("own")).toBe(before);
    });

    it("never serve a stale render after a template font changes", async () => {
      const dir = await fixture({
        "own/own.tsx": tpl("Local"),
        "own/fonts/fonts.yml":
          "- { file: l.woff, family: Local, weight: 400 }\n",
        "own/fonts/l.woff": await regular(),
      });
      await loadTemplates(dir);
      renderCache.clear();
      const args = {
        template: "own",
        values: { name: "Ada" },
        printer,
        jobId: "font-1",
      };
      const first = await renderJob(args);
      expect(await renderJob(args)).toBe(first);
      await writeFile(join(dir, "own", "fonts", "l.woff"), await bold());
      await loadTemplates(dir);
      expect(await renderJob(args)).not.toBe(first);
    });

    it("reload in development when a file in <name>/fonts changes", async () => {
      const dir = await fixture({
        "own/own.tsx": tpl("Local"),
        "own/fonts/fonts.yml":
          "- { file: l.woff, family: Local, weight: 400 }\n",
        "own/fonts/l.woff": await regular(),
      });
      await loadTemplates(dir);
      startTemplateWatcher(dir, { debounceMs: 40, retryMs: 60 });
      const rev = getLoadStatus().revision;
      await writeFile(join(dir, "own", "fonts", "l.woff"), await bold());
      await until(() => getLoadStatus().revision > rev);
      const local = getFonts("own").find((f) => f.name === "Local");
      expect((local?.data as Buffer).equals(await bold())).toBe(true);
    });
  });

  describe("watching", () => {
    afterEach(() => stopTemplateWatcher());

    it("reloads when a file inside a template folder changes", async () => {
      const dir = await fixture({
        "own/own.tsx": IMG_TEMPLATE,
        "own/images/mark.svg": svg("white"),
      });
      await loadTemplates(dir);
      startTemplateWatcher(dir, { debounceMs: 40, retryMs: 60 });
      expect(await blackPercent("own")).toBe(0);
      const rev = getLoadStatus().revision;
      await writeFile(join(dir, "own", "images", "mark.svg"), svg("black"));
      await until(() => getLoadStatus().revision > rev);
      // The square image is fit into the label, so not all of it is black.
      expect(await blackPercent("own")).toBeGreaterThan(50);
    });
  });
});

describe("load status", () => {
  it("counts every attempt and reports the problems of a failed one", async () => {
    const good = await fixture({ "keep.tsx": VALID_TSX });
    await loadTemplates(good);
    const first = getLoadStatus();
    expect(first.error).toBeNull();
    expect(new Date(first.loadedAt).toISOString()).toBe(first.loadedAt);

    await loadError(await fixture({ "x.ts": "export const y = 1;" }));
    const failed = getLoadStatus();
    expect(failed.revision).toBe(first.revision + 1);
    expect(failed.error?.[0]).toContain("x.ts");
    expect(getTemplate("keep")).toBeDefined();

    await loadTemplates(good);
    const healed = getLoadStatus();
    expect(healed.revision).toBe(first.revision + 2);
    expect(healed.error).toBeNull();
  });

  it("runs overlapping loads one after the other", async () => {
    const dir = await fixture({ "a.tsx": VALID_TSX });
    const before = getLoadStatus().revision;
    await Promise.all([
      loadTemplates(dir),
      loadTemplates(dir),
      loadTemplates(dir),
    ]);
    expect(getLoadStatus().revision).toBe(before + 3);
  });
});

describe("template sample", () => {
  const withSample = (sample: string) =>
    `${VALID_TSX}export const sample = ${sample};\n`;

  it("is listed when it fits the values and omitted otherwise", async () => {
    await loadTemplates(
      await fixture({
        "with.tsx": withSample('{ name: "Ada" }'),
        "without.tsx": VALID_TSX,
      }),
    );
    const list = listTemplates();
    expect(list.find((t) => t.name === "with")?.sample).toEqual({
      name: "Ada",
    });
    expect(list.find((t) => t.name === "without")).not.toHaveProperty("sample");
  });

  it("is a load problem when it doesn't fit the values or isn't an object", async () => {
    await loadTemplates(await fixture({ "keep.tsx": VALID_TSX }));
    const problems = await loadError(
      await fixture({
        "bad.tsx": withSample("{ name: 5 }"),
        "list.tsx": withSample("[1]"),
      }),
    );
    expect(
      problems.some((p) => p.startsWith('bad.tsx: "sample" doesn\'t fit')),
    ).toBe(true);
    expect(problems).toContain('list.tsx: "sample" must be an object');
    expect(getTemplate("keep")).toBeDefined();
  });
});

describe("render stats", () => {
  it("reports the black share, also for a cached render", async () => {
    await loadTemplates(await fixture(helperTemplate("black")));
    renderCache.clear();
    const args = { template: "tpl", values: {}, printer, jobId: "stats-1" };
    const first = await renderJob(args);
    expect(first.stats?.blackPercent).toBe(100);
    const second = await renderJob(args);
    expect(second).toBe(first);
    expect(second.stats?.blackPercent).toBe(100);
  });

  it("counts static images too", async () => {
    await loadTemplates(await fixture({ "blank@203.png": whitePng(100, 100) }));
    const out = await renderJob({ template: "blank", values: {}, printer });
    expect(out.stats?.blackPercent).toBe(0);
  });
});

describe("editor temp files", () => {
  it("are ignored by name", () => {
    for (const name of [
      ".hidden.tsx",
      "images/.DS_Store",
      "badge.tsx~",
      "badge.tsx.swp",
      "badge.tsx.tmp",
      "badge.tsx.orig",
      "4913",
      "lib/4913",
    ]) {
      expect(isEditorTempFile(name), name).toBe(true);
    }
    for (const name of [
      "badge.tsx",
      "lib/helper.ts",
      "images/logo.png",
      "fonts/fonts.yml",
      "2024.png",
    ]) {
      expect(isEditorTempFile(name), name).toBe(false);
    }
  });
});

describe("template watcher", () => {
  afterEach(() => stopTemplateWatcher());
  const opts = { debounceMs: 40, retryMs: 60 };

  it("shows a helper edit in the next render", async () => {
    const dir = await fixture(helperTemplate("white"));
    await loadTemplates(dir);
    expect(await blackPercent("tpl")).toBe(0);
    startTemplateWatcher(dir, opts);
    const rev = getLoadStatus().revision;
    await writeFile(
      join(dir, "lib", "helper.ts"),
      'export const fill = "black";\n',
    );
    await until(() => getLoadStatus().revision > rev);
    expect(await blackPercent("tpl")).toBe(100);
  });

  it("reloads a plain loadTemplates the same way, without a watcher", async () => {
    // Proves jiti serves the new helper without any help from the watcher.
    const dir = await fixture(helperTemplate("white"));
    await loadTemplates(dir);
    expect(await blackPercent("tpl")).toBe(0);
    await writeFile(
      join(dir, "lib", "helper.ts"),
      'export const fill = "black";\n',
    );
    await loadTemplates(dir);
    expect(await blackPercent("tpl")).toBe(100);
  });

  it("picks up new images and fonts files, and keeps the old registry on a bad edit", async () => {
    const dir = await fixture({
      "tag.tsx": VALID_TSX,
      "fonts/fonts.yml": "[]\n",
    });
    await loadTemplates(dir);
    startTemplateWatcher(dir, opts);
    let rev = getLoadStatus().revision;
    await mkdir(join(dir, "images"), { recursive: true });
    await writeFile(join(dir, "images", "x.png"), "x");
    await until(() => getLoadStatus().revision > rev);

    rev = getLoadStatus().revision;
    await writeFile(
      join(dir, "fonts", "fonts.yml"),
      "- { file: nope.woff, family: X, weight: 400 }\n",
    );
    await until(() => getLoadStatus().revision > rev);
    expect(getLoadStatus().error?.[0]).toContain("fonts/fonts.yml");
    expect(getTemplate("tag")).toBeDefined();

    rev = getLoadStatus().revision;
    await writeFile(join(dir, "fonts", "fonts.yml"), "[]\n");
    await until(() => getLoadStatus().revision > rev);
    expect(getLoadStatus().error).toBeNull();
  });

  it("ignores temp files and merges a burst into one reload", async () => {
    const dir = await fixture({ "tag.tsx": VALID_TSX });
    await loadTemplates(dir);
    startTemplateWatcher(dir, opts);
    const rev = getLoadStatus().revision;
    await writeFile(join(dir, "tag.tsx.swp"), "x");
    await writeFile(join(dir, "4913"), "x");
    await writeFile(join(dir, "tag.tsx~"), "x");
    await new Promise((r) => setTimeout(r, 300));
    expect(getLoadStatus().revision).toBe(rev);

    for (let i = 0; i < 5; i++) {
      await writeFile(join(dir, "tag.tsx"), `${VALID_TSX}// ${i}\n`);
    }
    await until(() => getLoadStatus().revision > rev);
    await new Promise((r) => setTimeout(r, 300));
    expect(getLoadStatus().revision).toBe(rev + 1);
  });

  it("waits for a missing directory and loads it when it appears", async () => {
    const dir = join(root, `late${counter++}`);
    startTemplateWatcher(dir, opts);
    await new Promise((r) => setTimeout(r, 150));
    const rev = getLoadStatus().revision;
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "late.tsx"), VALID_TSX);
    await until(() => getTemplate("late") !== undefined);
    expect(getLoadStatus().revision).toBeGreaterThan(rev);
  });

  it("stops watching", async () => {
    const dir = await fixture({ "tag.tsx": VALID_TSX });
    await loadTemplates(dir);
    startTemplateWatcher(dir, opts);
    stopTemplateWatcher();
    const rev = getLoadStatus().revision;
    await writeFile(join(dir, "tag.tsx"), `${VALID_TSX}// changed\n`);
    await new Promise((r) => setTimeout(r, 300));
    expect(getLoadStatus().revision).toBe(rev);
  });
});

describe("template studio routes", () => {
  const app = new Hono()
    .use(async (c, next) => {
      (c as never as { set: (k: string, v: unknown) => void }).set("user", {
        sub: "u1",
        username: "tester",
      });
      await next();
    })
    .route("/", printingAdminRouter);
  const post = (path: string, body?: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  afterEach(() => {
    cfg.NODE_ENV = "development";
  });

  it("answers 404 outside development", async () => {
    cfg.NODE_ENV = "production";
    expect((await app.request("/dev/status")).status).toBe(404);
    expect((await post("/dev/reload")).status).toBe(404);
  });

  it("reports the status and the templates", async () => {
    await loadTemplates(EXAMPLE_DIR);
    const res = await app.request("/dev/status");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ["enabled", "error", "loadedAt", "revision", "templates"].sort(),
    );
    expect(body.enabled).toBe(true);
    expect(body.error).toBeNull();
    expect(body.revision).toBe(getLoadStatus().revision);
    expect(body.templates).toEqual(JSON.parse(JSON.stringify(listTemplates())));
  });

  it("reloads from disk and reports a failure with status 200", async () => {
    const dir = await fixture({ "tag.tsx": VALID_TSX });
    await loadTemplates(dir);
    const rev = getLoadStatus().revision;

    let res = await post("/dev/reload");
    let body = (await res.json()) as {
      revision: number;
      error: string[] | null;
    };
    expect(res.status).toBe(200);
    expect(body.revision).toBe(rev + 1);
    expect(body.error).toBeNull();

    await writeFile(join(dir, "bad.ts"), "export const y = 1;");
    res = await post("/dev/reload");
    body = (await res.json()) as typeof body;
    expect(res.status).toBe(200);
    expect(body.revision).toBe(rev + 2);
    expect(body.error?.[0]).toContain("bad.ts");
    // The last working registry is still the one in use.
    expect(getTemplate("tag")).toBeDefined();
  });

  it("sets render stats headers on the preview", async () => {
    await loadTemplates(EXAMPLE_DIR);
    const res = await post("/templates/example-name-tag/preview", {
      values: { firstName: "Ada" },
      dpi: 203,
      widthDots: 406,
      lengthDots: 305,
    });
    expect(res.status).toBe(200);
    expect(Number(res.headers.get("x-render-ms"))).toBeGreaterThanOrEqual(0);
    const black = Number(res.headers.get("x-black-percent"));
    expect(black).toBeGreaterThanOrEqual(0);
    expect(black).toBeLessThanOrEqual(100);
  });
});

describe("template size", () => {
  const withSize = (size: string) =>
    `${VALID_TSX}export const size = ${size};\n`;
  const ctx = { values: { name: "Ada" } };
  const sized = (size: string) => fixture({ "tag.tsx": withSize(size) });
  const app = new Hono()
    .use(async (c, next) => {
      (c as never as { set: (k: string, v: unknown) => void }).set("user", {
        sub: "u1",
        username: "tester",
      });
      await next();
    })
    .route("/", printingAdminRouter);
  const preview = async (body: Record<string, unknown>) => {
    const res = await app.request("/templates/tag/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...ctx, dpi: 203, ...body }),
    });
    return { res, png: Buffer.from(await res.arrayBuffer()) };
  };

  it("is listed when present and omitted otherwise", async () => {
    await loadTemplates(
      await fixture({
        "with.tsx": withSize("{ widthMm: 50, lengthMm: 100 }"),
        "without.tsx": VALID_TSX,
      }),
    );
    const list = listTemplates();
    expect(list.find((t) => t.name === "with")?.size).toEqual({
      widthMm: 50,
      lengthMm: 100,
    });
    expect(list.find((t) => t.name === "without")).not.toHaveProperty("size");
    expect(list.find((t) => t.name === TEST_TEMPLATE)).not.toHaveProperty(
      "size",
    );
  });

  it("is a load problem when it isn't a sensible size", async () => {
    await loadTemplates(await fixture({ "keep.tsx": VALID_TSX }));
    const problems = await loadError(
      await fixture({
        "str.tsx": withSize('{ widthMm: "50" }'),
        "small.tsx": withSize("{ lengthMm: 5 }"),
        "huge.tsx": withSize("{ widthMm: 501 }"),
        "nan.tsx": withSize("{ widthMm: NaN }"),
        "arr.tsx": withSize("[50]"),
        "empty.tsx": withSize("{}"),
        "typo.tsx": withSize("{ width: 50 }"),
      }),
    );
    for (const f of ["str", "small", "huge", "nan", "arr", "empty", "typo"]) {
      expect(
        problems.some((p) => p.startsWith(`${f}.tsx: "size`)),
        f,
      ).toBe(true);
    }
    expect(getTemplate("keep")).toBeDefined();
  });

  it("works in a folder template", async () => {
    await loadTemplates(
      await fixture({ "tag/tag.tsx": withSize("{ lengthMm: 60 }") }),
    );
    expect(listTemplates().find((t) => t.name === "tag")?.size).toEqual({
      lengthMm: 60,
    });
  });

  it("renders on the template's canvas, per side", async () => {
    await loadTemplates(await sized("{ widthMm: 40, lengthMm: 30 }"));
    const big = { ...printer, widthDots: 800, lengthDots: 600 };
    let d = decode(
      (await renderJob({ template: "tag", values: ctx.values, printer: big }))
        .png,
    );
    expect([d.w, d.h]).toEqual([320, 240]);
    await loadTemplates(await sized("{ lengthMm: 30 }"));
    d = decode(
      (await renderJob({ template: "tag", values: ctx.values, printer: big }))
        .png,
    );
    expect([d.w, d.h]).toEqual([800, 240]);
  });

  it("fails when the canvas is larger than the printer's label", async () => {
    await loadTemplates(await sized("{ widthMm: 40, lengthMm: 100 }"));
    const small = { ...printer, widthDots: 400, lengthDots: 700 };
    await expect(
      renderJob({ template: "tag", values: ctx.values, printer: small }),
    ).rejects.toThrow(
      'template "tag" is 800 dots long but the printer\'s label is 700',
    );
    const narrow = { ...printer, widthDots: 300, lengthDots: 900 };
    await expect(
      renderJob({ template: "tag", values: ctx.values, printer: narrow }),
    ).rejects.toThrow(/320 dots wide but the printer's label is 300/);
  });

  it("accepts a canvas smaller than the label and caches per printer", async () => {
    await loadTemplates(await sized("{ widthMm: 40, lengthMm: 30 }"));
    renderCache.clear();
    const a = { ...printer, widthDots: 400, lengthDots: 300 };
    const b = { ...printer, widthDots: 400, lengthDots: 310 };
    const args = { template: "tag", values: ctx.values, jobId: "size-1" };
    expect((await renderJob({ ...args, printer: a })).height).toBe(240);
    expect((await renderJob({ ...args, printer: b })).height).toBe(240);
    expect(renderCache.size).toBe(2);
  });

  it("overrides the preview body's dots for the sides it defines", async () => {
    await loadTemplates(await sized("{ widthMm: 40, lengthMm: 30 }"));
    let { res, png } = await preview({ widthDots: 100, lengthDots: 100 });
    expect(res.status).toBe(200);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([320, 240]);
    await loadTemplates(await sized("{ widthMm: 40 }"));
    ({ res, png } = await preview({ widthDots: 100, lengthDots: 150 }));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([320, 150]);
  });
});
