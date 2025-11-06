import { createSocketRouter, type InferListeners } from "../socketRouter.ts";
import type { MessageTypes } from "./messageTypes.ts";
import { authRouter, requireAuth } from "./auth.socket.ts";

export const router = createSocketRouter<MessageTypes>();

const routes = router
  .use(authRouter)
  .bind("heartbeat", null, requireAuth, (_c, evt, ws) => {
    console.log("Hi!", evt.data);
    ws.send({
      name: "heartbeat",
    });
  });

export type Listeners = InferListeners<typeof routes>;
