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

export const pendingAutoRestartAtom = atom(false);
