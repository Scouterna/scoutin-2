import { atom } from "jotai";

export type SessionInfo = {
  id: string;
  token: string;
};

export const sessionInfoAtom = atom<SessionInfo | null>(null);

export type CurrentScreen = {
  screenId: string;
};

export const currentScreenAtom = atom<CurrentScreen | null>(null);
