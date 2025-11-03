import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { Context } from "hono";
import type { WSContext, WSEvents, WSMessageReceive } from "hono/ws";
import type { Simplify } from "type-fest";

type TypedEvent<TSchema extends StandardSchemaV1<object, object> | null> = Omit<
  MessageEvent<WSMessageReceive>,
  "data"
> & {
  data: TSchema extends StandardSchemaV1
    ? StandardSchemaV1.InferOutput<TSchema>
    : { [k: string]: never };
};

export type TypedWSContext<TMessage> = Omit<WSContext<WebSocket>, "send"> & {
  send(source: TMessage): void;
};

export type Next = () => Promise<void>;

export type RouteMiddleare<
  TSchema extends StandardSchemaV1<object, object> | null,
  TServerMessage,
> = (
  c: Context,
  evt: TypedEvent<TSchema>,
  ws: TypedWSContext<TServerMessage>,
  next: Next,
) => Promise<void> | void;

type RouteBind = {
  validator: StandardSchemaV1<object, object> | null;
  // biome-ignore lint/suspicious/noExplicitAny: It makes sense here
  middleware: RouteMiddleare<any, any>[];
};

export type InferListeners<T> = Simplify<
  T extends { __listeners: infer U } ? U : never
>;

type MessageHandler = Exclude<WSEvents["onMessage"], undefined>;

export function createSocketRouter<TServerMessage extends { name: string }>() {
  const routes: Record<string, RouteBind> = {};

  type Router<TRoutes extends Record<string, unknown>> = {
    onMessage: (c: Context) => MessageHandler;
    bind: <
      TName extends string,
      TSchema extends StandardSchemaV1<object, object> | null,
    >(
      name: TName,
      validator: TSchema,
      ...middleware: RouteMiddleare<TSchema, TServerMessage>[]
    ) => Router<
      TRoutes & {
        [K in TName]: {
          input: TSchema extends StandardSchemaV1
            ? StandardSchemaV1.InferOutput<TSchema>
            : null;
        };
      }
    >;
    __listeners: TRoutes;
  };

  const onMessage =
    (c: Context): MessageHandler =>
    (evt, ws) => {
      if (!evt.data || typeof evt.data !== "string") {
        console.warn("Received invalid message:", evt.data);
        return;
      }

      const data = JSON.parse(evt.data);
      if (!("name" in data)) {
        console.warn("Received message without name:", data);
        return;
      }

      const route = routes[data.name];
      if (!route || route.middleware.length === 0) {
        console.warn(`No handler for message name: ${data.name}`);
        return;
      }

      let index = -1;
      const next = async (): Promise<void> => {
        index++;
        if (index < route.middleware.length) {
          const middleware = route.middleware[index];
          if (!middleware) {
            throw new Error("Middleware iteration failed");
          }

          const typedEvent = {
            ...evt,
            data,
          };
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

  const bind = (
    name: string,
    validator: StandardSchemaV1<object, object> | null,
    // biome-ignore lint/suspicious/noExplicitAny: We don't care here
    ...middleware: RouteMiddleare<any, any>[]
  ) => {
    routes[name] = {
      validator,
      middleware,
    };

    return router;
  };

  const router = {
    onMessage,
    bind,
    // biome-ignore lint/complexity/noBannedTypes: We need it here
  } as unknown as Router<{}>;

  return router;
}
