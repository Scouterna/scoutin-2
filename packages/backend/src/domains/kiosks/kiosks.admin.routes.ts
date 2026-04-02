import { type } from "arktype";
import { Hono } from "hono";
import {
  createKioskSetupToken,
  deleteKiosk,
  listKiosks,
  renameKiosk,
} from "./kiosk.service.ts";

const RenameBody = type({ name: "string > 0" });

export const kiosksAdminRouter = new Hono()
  .get("/", async (c) => {
    const kiosks = await listKiosks();
    return c.json({ kiosks });
  })
  .post("/", async (c) => {
    const { code, expiresAt } = await createKioskSetupToken();
    return c.json({ code, expiresAt }, 201);
  })
  .patch("/:id", async (c) => {
    const id = c.req.param("id");
    const body = RenameBody(await c.req.json());
    if (body instanceof type.errors) {
      return c.json({ error: body.summary }, 400);
    }
    const kiosk = await renameKiosk(id, body.name);
    if (!kiosk) return c.json({ error: "Kiosk not found" }, 404);
    return c.json(kiosk);
  })
  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    const deleted = await deleteKiosk(id);
    if (!deleted) return c.json({ error: "Kiosk not found" }, 404);
    return c.body(null, 204);
  });
