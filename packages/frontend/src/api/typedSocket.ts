export type TypedSocket<
  TSendTypes extends { name: string },
  TListenTypes extends { name: string },
> = Omit<WebSocket, "send"> & {
  send: (data: TSendTypes) => void;
  on<TName extends TListenTypes["name"]>(
    name: TName,
    listener: Extract<TListenTypes, { name: TName }> extends { data: infer D }
      ? (data: D) => void
      : () => void,
  ): void;
  once<TName extends TListenTypes["name"]>(
    name: TName,
    listener: Extract<TListenTypes, { name: TName }> extends { data: infer D }
      ? (data: D) => void
      : () => void,
  ): void;
  off<TName extends TListenTypes["name"]>(
    name: TName,
    listener: Extract<TListenTypes, { name: TName }> extends { data: infer D }
      ? (data: D) => void
      : () => void,
  ): void;
  Infer: {
    [K in TListenTypes["name"]]: Extract<TListenTypes, { name: K }> extends {
      data: infer D;
    }
      ? D
      : never;
  };
};

export function createTypedSocket<
  TSendTypes extends { name: string },
  TListenTypes extends { name: string },
>(socket: WebSocket): TypedSocket<TSendTypes, TListenTypes> {
  const listeners = new Map<string, Array<(data: unknown) => void>>();

  // TODO: Do we need cleanup of listeners on socket close?

  socket.addEventListener("message", (event) => {
    // console.log(event.data);
    try {
      const parsed = JSON.parse(event.data);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        console.error("Received message that is not an object:", parsed);
        return;
      }
      if (!("name" in parsed)) {
        console.error("Received message without name:", parsed);
        return;
      }

      const name = parsed.name;
      const data = parsed.data;

      if (listeners.has(name)) {
        // biome-ignore lint/style/noNonNullAssertion: We check has above
        for (const listener of listeners.get(name)!) {
          try {
            listener(data);
          } catch (handlerError) {
            console.error(
              `Error in message handler for "${name}":`,
              handlerError,
            );
            // Note: We don't show toast here to avoid spam, but log to console
          }
        }
      } else {
        console.warn(`No listeners for message: ${name}`);
      }
    } catch (e) {
      console.error("Failed to parse WebSocket message:", e);
    }
  });

  const send = (data: unknown) => {
    socket.send(JSON.stringify(data));
  };
  const on = (name: string, listener: (data: unknown) => void) => {
    if (!listeners.has(name)) {
      listeners.set(name, []);
    }
    // biome-ignore lint/style/noNonNullAssertion: We just set it
    listeners.get(name)!.push(listener);
  };
  const off = (name: string, listener: (data: unknown) => void) => {
    if (!listeners.has(name)) return;
    // biome-ignore lint/style/noNonNullAssertion: We just set it
    const updatedListeners = listeners.get(name)!.filter((l) => l !== listener);
    listeners.set(name, updatedListeners);
  };

  return {
    ...socket,
    send,
    on,
    off,
  } as unknown as TypedSocket<TSendTypes, TListenTypes>;
}
