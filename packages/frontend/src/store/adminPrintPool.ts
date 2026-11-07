import { atomWithStorage } from "jotai/utils";

/**
 * The print pool the admin picked for sessions started from the admin panel.
 * Persisted per browser. May hold an id that no longer exists; consumers must
 * validate it against the loaded pools before sending it.
 */
export const adminPrintPoolIdAtom = atomWithStorage<string | null>(
  "scoutin.adminPrintPoolId",
  null,
);
