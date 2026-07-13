import { arktypeValidator } from "@hono/arktype-validator";
import { type } from "arktype";
import { Hono } from "hono";
import { recordAudit } from "../audit/audit.service.ts";
import { countBlocks, createBlock, removeBlock } from "./blocklist.service.ts";

const CreateBlockBody = type({
  "participantId?": "string",
  "identifiers?": "string[]",
  "reason?": "string",
});

const RemoveBlockBody = type({
  identifier: "string",
});

export const blocklistAdminRouter = new Hono()
  // Create a block. Response body is constant (never reveals whether the person
  // was already blocked). This is not full probing protection - the count
  // endpoint and the kiosk both leak membership - it just avoids an extra signal.
  .post("/", arktypeValidator("json", CreateBlockBody), async (c) => {
    const { participantId, identifiers, reason } = c.req.valid("json");

    const result = await createBlock({ participantId, identifiers, reason });

    // Audit records only non-identifying facts - never the identifier/hash.
    await recordAudit({
      actor: "admin",
      action: "blocklist.add",
      details: {
        blockId: result.blockId,
        kind: participantId ? "participant" : "manual",
        identifierCount: result.identifierCount,
      },
    });

    return c.json({ ok: true });
  })
  // Remove by any one identifier. Response body is constant regardless of
  // match, though the block count still reflects a successful removal.
  .post("/remove", arktypeValidator("json", RemoveBlockBody), async (c) => {
    const { identifier } = c.req.valid("json");

    const matched = await removeBlock(identifier);

    await recordAudit({
      actor: "admin",
      action: "blocklist.remove",
      details: { matched },
    });

    return c.json({ ok: true });
  })
  // Count only - never exposes list contents.
  .get("/count", async (c) => {
    const count = await countBlocks();
    c.header("Cache-Control", "no-store");
    return c.json({ count });
  });
