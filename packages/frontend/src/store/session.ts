import {
  DEFAULT_LANGUAGE,
  type Language,
} from "@scouterna/scoutin-plugin-api/frontend";
import { atom } from "jotai";

export type SessionCredentials = {
  id: string;
  token: string;
};

export const sessionCredentialsAtom = atom<SessionCredentials | null>(null);

export type CurrentScreen = {
  screenId: string;
  payload: object;
};

export const currentScreenAtom = atom<CurrentScreen | null>(null);
export const screenHistoryAtom = atom<CurrentScreen[]>([]);

export type SessionInfo = {
  actor: {
    firstName: string;
    lastName: string;
    idInDataSource: string;
  } | null;
};

export const sessionInfoAtom = atom<SessionInfo | null>(null);

/**
 * The language the current session is conducted in, as reported by the server
 * via `session:info`. Resets to the default between sessions.
 */
export const languageAtom = atom<Language>(DEFAULT_LANGUAGE);

export const pendingAutoRestartAtom = atom(false);

// Reported by the server via `session:navigation`.
export type NavigationState = {
  /** A barrier would not refuse a go-back. Independent of the lock. */
  canGoBack: boolean;
  /** The current step holds the navigation lock. */
  locked: boolean;
};

// Matches the behavior before the server says otherwise.
export const DEFAULT_NAVIGATION: NavigationState = {
  canGoBack: true,
  locked: false,
};

export const navigationAtom = atom<NavigationState>(DEFAULT_NAVIGATION);
