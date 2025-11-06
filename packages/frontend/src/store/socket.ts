import type { Listeners, MessageTypes } from "@scouterna/scoutin-backend";
import { atom } from "jotai";
import type { TypedSocket } from "../api/typedSocket";

export const socketAtom = atom<TypedSocket<Listeners, MessageTypes> | null>(
  null,
);
