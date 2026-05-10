import { type } from "arktype";
import { Hono } from "hono";
import { prisma } from "../../app/prisma.ts";

const DEFAULT_CONFIG_FILE = "stepConfig.yml";

const CreateLinkBody = type({
  "configFile?": "string",
  "params?": "Record<string, unknown>",
});

export const linksAdminRouter = new Hono()
  .post("/", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = CreateLinkBody(body);
    if (parsed instanceof type.errors) {
      return c.json({ error: "Invalid body" }, 400);
    }

    const link = await prisma.checkinLink.create({
      data: {
        configFile: parsed.configFile ?? DEFAULT_CONFIG_FILE,
        params: JSON.parse(JSON.stringify(parsed.params ?? {})),
      },
    });

    return c.json({ id: link.id, configFile: link.configFile, createdAt: link.createdAt }, 201);
  })
  .get("/", async (c) => {
    const links = await prisma.checkinLink.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, configFile: true, params: true, createdAt: true },
    });
    return c.json({ links });
  })
  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    try {
      await prisma.checkinLink.delete({ where: { id } });
    } catch (e: unknown) {
      if (
        e instanceof Error &&
        "code" in e &&
        (e as { code: string }).code === "P2025"
      ) {
        return c.json({ error: "Link not found" }, 404);
      }
      throw e;
    }
    return c.body(null, 204);
  });
