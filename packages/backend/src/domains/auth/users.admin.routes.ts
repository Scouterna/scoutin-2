import { arktypeValidator } from "@hono/arktype-validator";
import { type } from "arktype";
import { Hono } from "hono";
import type { AppEnv } from "../../core/websocket/types.ts";
import {
  createUser,
  deleteUser,
  LastAdminError,
  listUsers,
  resetPassword,
  updateUser,
} from "./user.service.ts";

const CreateBody = type({
  username: "string > 0",
  password: "string > 0",
  roles: "string[]",
});

const UpdateBody = type({
  roles: "string[]",
});

const PasswordBody = type({ password: "string > 0" });

/** Guarded by requireAdmin (mounted under the admin router in app/admin.ts). */
export const usersAdminRouter = new Hono<AppEnv>()
  .get("/", async (c) => {
    return c.json({ users: await listUsers() });
  })
  .post("/", arktypeValidator("json", CreateBody), async (c) => {
    const body = c.req.valid("json");
    try {
      const user = await createUser(body);
      return c.json({ user }, 201);
    } catch (err) {
      // Unique constraint on username.
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        err.code === "P2002"
      ) {
        return c.json({ error: "Username already taken" }, 409);
      }
      throw err;
    }
  })
  .patch("/:id", arktypeValidator("json", UpdateBody), async (c) => {
    const id = c.req.param("id");
    try {
      const user = await updateUser(id, c.req.valid("json"));
      return c.json({ user });
    } catch (err) {
      if (err instanceof LastAdminError) {
        return c.json({ error: err.message }, 409);
      }
      throw err;
    }
  })
  .post("/:id/password", arktypeValidator("json", PasswordBody), async (c) => {
    await resetPassword(c.req.param("id"), c.req.valid("json").password);
    return c.body(null, 204);
  })
  .delete("/:id", async (c) => {
    try {
      await deleteUser(c.req.param("id"));
      return c.body(null, 204);
    } catch (err) {
      if (err instanceof LastAdminError) {
        return c.json({ error: err.message }, 409);
      }
      throw err;
    }
  });
