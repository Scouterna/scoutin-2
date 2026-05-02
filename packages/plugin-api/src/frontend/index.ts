import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useRef } from "react";

export type * from "../backend/index.ts";
export { BottomSheet } from "./BottomSheet.tsx";
export { ValidationError } from "./ValidationError.tsx";

export interface PluginSocket {
  send(message: { name: string; data?: unknown }): void;
  onMessage(name: string, handler: (payload: object) => void): () => void;
}

export const PluginSocketContext = createContext<PluginSocket | null>(null);

export function usePluginSocket(): PluginSocket | null {
  return useContext(PluginSocketContext);
}

export function usePluginMessage(
  name: string,
  handler: (payload: object) => void,
) {
  const socket = usePluginSocket();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!socket) return;
    return socket.onMessage(name, (payload) => handlerRef.current(payload));
  }, [socket, name]);
}

export type ScreenConfig = {
  name: string;
  component: ({ payload }: { payload: object }) => ReactNode;
};

export type FrontendPluginContext = {
  registerScreen(screen: ScreenConfig): void;
};

export type FrontendPlugin = {
  setup(ctx: FrontendPluginContext): void;
};
