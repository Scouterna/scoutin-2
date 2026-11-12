import { createHash } from "node:crypto";

/** SHA-256 hex of a high-entropy secret (device keys, API keys). */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** The token of an `Authorization: Bearer <token>` header, or null. */
export function readBearerToken(header: string | undefined): string | null {
  return header?.match(/^Bearer (.+)$/)?.[1] ?? null;
}
