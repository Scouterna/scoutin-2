import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useRef } from "react";

export type * from "../backend/index.ts";
export {
  coerceLanguage,
  DEFAULT_LANGUAGE,
  isSupportedLanguage,
  LANGUAGE_LABELS,
  type Language,
  LocalizedString,
  resolveLocalized,
  SUPPORTED_LANGUAGES,
} from "../i18n.ts";
export { BottomSheet } from "./BottomSheet.tsx";
export { CtaButton } from "./CtaButton.tsx";
export {
  type Dictionary,
  LanguageContext,
  type Translate,
  useLanguage,
  useTranslations,
} from "./i18n.tsx";
export { ScreenActions } from "./ScreenActions.tsx";
export { ValidationError } from "./ValidationError.tsx";

export interface PluginSocket {
  send(message: { name: string; data?: unknown }): void;
  onMessage(name: string, handler: (payload: object) => void): () => void;
}

export const PluginSocketContext = createContext<PluginSocket | null>(null);

export function usePluginSocket(): PluginSocket | null {
  return useContext(PluginSocketContext);
}

/**
 * True while the kiosk asks whether anyone is still there (the idle countdown
 * is showing). Use it to pause attention-grabbing animation behind the dialog.
 * Always false outside the kiosk.
 */
export const IdleContext = createContext(false);

export function useIsIdle(): boolean {
  return useContext(IdleContext);
}

/** Who is looking at the screen: the kiosk itself, or staff in the admin UI. */
export type SessionRole = "kiosk" | "staff";

export const SessionRoleContext = createContext<SessionRole>("kiosk");

/**
 * Whether the screen is shown on the kiosk or to staff. Use it to show staff-only
 * actions; the step's method must still check `ctx.role`, since a kiosk can send
 * any method call.
 */
export function useSessionRole(): SessionRole {
  return useContext(SessionRoleContext);
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
