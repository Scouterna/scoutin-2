import { prisma } from "../../app/prisma.ts";
import { logger } from "../../core/logging/logger.ts";

const log = logger.child({ module: "audit" });

export type AuditEntry = {
  /** Who performed the action. "admin" today (single shared admin password). */
  actor?: string | null;
  /** Namespaced action name, e.g. "blocklist.add". */
  action: string;
  /**
   * Action-specific, free-form context. MUST NOT contain personal identifiers
   * or their hashes for anonymity-sensitive actions (e.g. blocklist).
   */
  details?: Record<string, unknown>;
};

/**
 * Append a row to the generic, append-only audit log. Failures are logged and
 * swallowed - an audit write must never break the action it records.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actor: entry.actor ?? null,
        action: entry.action,
        // Coerce to a plain JSON value for Prisma's Json input type.
        details:
          entry.details === undefined
            ? undefined
            : JSON.parse(JSON.stringify(entry.details)),
      },
    });
  } catch (error) {
    log.error({ error, action: entry.action }, "Failed to write audit log");
  }
}
