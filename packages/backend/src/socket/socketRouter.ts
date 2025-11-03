import type { StandardSchemaV1 } from "@standard-schema/spec";
import { type } from "arktype";
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

export type RouteMiddleware<
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
  middleware: RouteMiddleware<any, any>[];
};

export type InferListeners<T> = Simplify<
  T extends { __listeners: infer U } ? U : never
>;

type MessageHandler = Exclude<WSEvents["onMessage"], undefined>;

const parsePayload = type("string.json.parse").to({
  name: "string",
  data: "object",
});

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
      ...middleware: RouteMiddleware<TSchema, TServerMessage>[]
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
      const payload = parsePayload(evt.data);
      if (payload instanceof type.errors) {
        console.warn("Failed to parse message:", payload.summary);
        ws.send(
          JSON.stringify({
            name: "error",
            data: {
              code: "invalid_format",
              message: "Invalid message format",
            },
          }),
        );
        return;
      }

      const route = routes[payload.name];
      if (!route || route.middleware.length === 0) {
        console.warn(`No handler for message name: ${payload.name}`);
        ws.send(
          JSON.stringify({
            name: "error",
            data: {
              code: "unknown_message",
              message: `Unknown message name: ${payload.name}`,
            },
          }),
        );
        return;
      }

      let data: unknown = payload.data;
      if (route.validator) {
        const validationResult = route.validator["~standard"].validate(data);
        if (validationResult instanceof Promise) {
          throw new Error("Async validation is not supported in this context");
        }

        if (validationResult.issues) {
          console.warn(
            `Validation failed for message "${payload.name}":`,
            validationResult.issues,
          );
          ws.send(
            JSON.stringify({
              name: "error",
              data: {
                code: "invalid_payload",
                message: `Invalid payload for message "${payload.name}"`,
              },
            }),
          );
          return;
        }

        data = validationResult.value;
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
    ...middleware: RouteMiddleware<any, any>[]
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
