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
  actor: { firstName: string; lastName: string } | null;
};

export const sessionInfoAtom = atom<SessionInfo | null>(null);

/**
 * The language the current session is conducted in, as reported by the server
 * via `session:info`. Resets to the default between sessions.
 */
export const languageAtom = atom<Language>(DEFAULT_LANGUAGE);

export const pendingAutoRestartAtom = atom(false);
