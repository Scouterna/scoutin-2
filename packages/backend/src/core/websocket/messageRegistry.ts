import type { StandardSchemaV1 } from "@standard-schema/spec";

type MessageTypeEntry = {
  validator: StandardSchemaV1<object, object>;
};

export function createMessageRegistry() {
  type Registry<TMessageTypes extends Record<string, MessageTypeEntry>> = {
    register: <
      TName extends string,
      TValidator extends StandardSchemaV1<object, object> | undefined,
    >(
      name: TName,
      validator?: TValidator,
    ) => Registry<
      TMessageTypes & {
        [K in TName]: {
          validator: TValidator;
        };
      }
    >;
    messageTypes: TMessageTypes;
  };

  const register = (
    name: string,
    validator: StandardSchemaV1<object, object>,
  ) => {
    const reg = registry.messageTypes as Record<string, MessageTypeEntry>;
    reg[name] = {
      validator,
    };
    return registry;
  };

  const registry = {
    register,
    messageTypes: {},
    // biome-ignore lint/complexity/noBannedTypes: We need it here
  } as Registry<{}>;

  return registry;
}

export type InferMessageTypes<T> = T extends { messageTypes: infer U }
  ? {
      [K in keyof U]: U[K] extends { validator: StandardSchemaV1 }
        ? {
            name: K;
            data: StandardSchemaV1.InferOutput<U[K]["validator"]>;
          }
        : {
            name: K;
          };
    }[keyof U]
  : never;
