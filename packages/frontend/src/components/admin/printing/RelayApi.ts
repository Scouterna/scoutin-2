import type { InferResponseType } from "hono/client";
import type { api } from "@/api/api";

// Everything here is inferred from the typed Hono client, so the relay shapes
// follow the backend without a second copy of the contract.

export type PairingColor = NonNullable<
  Parameters<typeof api.admin.printing.pairing.lookup.$post>[0]
>["json"]["colors"][number];

type RelayListResponse = InferResponseType<
  typeof api.admin.printing.relays.$get,
  200
>;
export type Relay = RelayListResponse["relays"][number];

export type RelayPrinter = Relay["printers"][number];

export type RelayActionKind = Parameters<
  (typeof api.admin.printing.relays)[":id"]["actions"]["$post"]
>[0] extends { json: { kind: infer K } }
  ? K
  : never;

export type PairingFound = InferResponseType<
  typeof api.admin.printing.pairing.lookup.$post,
  200
>;

export const relaysQueryKey = ["admin", "printing", "relays"];

/** Throws with the server's error message when a response isn't ok. */
export async function assertRelayOk(res: Response): Promise<void> {
  if (res.ok) return;
  let message = "Något gick fel";
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) message = body.error;
  } catch {
    // keep the fallback
  }
  throw new Error(message);
}
