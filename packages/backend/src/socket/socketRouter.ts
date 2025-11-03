import type { Context } from "hono";
import type { WSContext, WSMessageReceive } from "hono/ws";

export type TypedWSContext<TMessage> = Omit<WSContext<WebSocket>, "send"> & {
  send(source: TMessage): void;
};

export type Next = () => Promise<void>;

type TypedEvent<TEventBody> = Omit<MessageEvent<WSMessageReceive>, "data"> & {
  data: TEventBody;
};

export type RouteMiddleare<EventBody, TServerMessage> = (
  c: Context,
  evt: TypedEvent<EventBody>,
  ws: TypedWSContext<TServerMessage>,
  next: Next,
) => Promise<void> | void;

export function createSocketRouter<
  TClientMessage extends { name: string },
  TServerMessage extends { name: string },
>() {
  type MessageName = TClientMessage["name"];
  const routes: Record<string, RouteMiddleare<unknown, TServerMessage>[]> = {};

  const onMessage =
    (c: Context) =>
    (evt: MessageEvent<WSMessageReceive>, ws: WSContext<WebSocket>) => {
      if (!evt.data || typeof evt.data !== "string") {
        console.warn("Received invalid message:", evt.data);
        return;
      }

      const data = JSON.parse(evt.data) as TClientMessage;
      if (!("name" in data)) {
        console.warn("Received message without name:", data);
        return;
      }

      const middlewares = routes[data.name];
      if (!middlewares || middlewares.length === 0) {
        console.warn(`No handler for message name: ${data.name}`);
        return;
      }

      let index = -1;
      const next = async (): Promise<void> => {
        index++;
        if (index < middlewares.length) {
          const middleware = middlewares[index];
          if (!middleware) {
            throw new Error("Middleware iteration failed");
          }

          const typedEvent = {
            ...evt,
            data,
          } as TypedEvent<Extract<TClientMessage, { name: typeof data.name }>>;
          const typedContext = {
            ...ws,
            send(source: TServerMessage) {
              const message = JSON.stringify(source);
              ws.send(message);
            },
          } as TypedWSContext<TServerMessage>;
          await middleware(c, typedEvent, typedContext, next);
        }
      };

      next().catch((err) => {
        console.error("Error processing WebSocket message:", err);
      });
    };

  const bind = <TKey extends MessageName>(
    name: TKey,
    ...middleware: RouteMiddleare<
      Extract<TClientMessage, { name: TKey }>,
      TServerMessage
    >[]
  ) => {
    routes[name] = middleware as RouteMiddleare<unknown, TServerMessage>[];
  };

  return {
    onMessage,
    bind,
  };
}
