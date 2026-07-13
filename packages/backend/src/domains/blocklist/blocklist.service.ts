import { createHmac } from "node:crypto";
import { prisma } from "../../app/prisma.ts";
import config from "../../config/config.ts";
import {
  findParticipantsByLookupValue,
  hashLookupValue,
  normalizeIdentifier,
} from "../participants/data.service.ts";

// Separate key from DATASOURCE_HASHING_* on purpose: discarding/rotating it
// renders the entire blocklist inert without touching any row.
const blocklistSecret = Buffer.from(config.BLOCKLIST_HASHING_SECRET);

/**
 * The second HMAC applied over an already-computed lookup hash. Storing this
 * (rather than the lookup hash itself) means the blocklist cannot be joined to
 * the participants table, and cannot be read without `blocklistSecret`.
 */
export function hashBlockValue(lookupHash: string): string {
  return createHmac("sha256", blocklistSecret).update(lookupHash).digest("hex");
}

/**
 * Whether a submitted check-in identifier is blocked. Called natively at the
 * identify step, before participant resolution, so it also catches people who
 * aren't in the participants table.
 *
 * Two checks in one query:
 *  - direct match on the submitted identifier (covers non-participants), and
 *  - fan-out over every lookup value of any participant it resolves to (covers
 *    a participant entering with a different identifier than the one blocked).
 */
export async function isBlocked(query: string): Promise<boolean> {
  const normalized = normalizeIdentifier(query);

  // Direct match - included even when nothing resolves, so a blocked
  // non-participant is caught before the "not found" path.
  const lookupHashes = new Set<string>([hashLookupValue(normalized)]);

  // Fan-out: any identifier of a resolved participant.
  const participants = await findParticipantsByLookupValue(normalized);
  for (const participant of participants) {
    for (const lookupHash of participant.lookupValues) {
      lookupHashes.add(lookupHash);
    }
  }

  const blockHashes = [...lookupHashes].map(hashBlockValue);

  const hit = await prisma.blockedIdentifier.findFirst({
    where: { blockHash: { in: blockHashes } },
    select: { id: true },
  });

  return hit !== null;
}

export type CreateBlockInput = {
  /** Block a known participant - fans out over all their identifiers. */
  participantId?: string;
  /** Block raw identifiers (e.g. a non-participant). Each is normalized+hashed. */
  identifiers?: string[];
  /** Optional, admin-visible note. Not anonymous - keep non-identifying. */
  reason?: string;
};

export type CreateBlockResult = {
  blockId: string | null;
  identifierCount: number;
};

/**
 * Create a block. Returns counts for the audit log only; the route responds
 * with a constant body. Note this does not make membership unprobeable - the
 * block count changes only when something new is added, and the kiosk reveals
 * blocked status directly. The constant body just avoids an extra signal.
 */
export async function createBlock(
  input: CreateBlockInput,
): Promise<CreateBlockResult> {
  const lookupHashes = new Set<string>();

  if (input.participantId) {
    const participant = await prisma.participant.findUnique({
      where: { id: input.participantId },
      select: { lookupValues: true },
    });
    for (const lookupHash of participant?.lookupValues ?? []) {
      lookupHashes.add(lookupHash);
    }
  }

  for (const identifier of input.identifiers ?? []) {
    const trimmed = identifier.trim();
    if (trimmed) {
      lookupHashes.add(hashLookupValue(normalizeIdentifier(trimmed)));
    }
  }

  const blockHashes = [...lookupHashes].map(hashBlockValue);
  if (blockHashes.length === 0) {
    return { blockId: null, identifierCount: 0 };
  }

  // Skip identifiers already blocked (blockHash is globally unique). This keeps
  // creation idempotent; the person stays blocked via the existing entry.
  const existing = await prisma.blockedIdentifier.findMany({
    where: { blockHash: { in: blockHashes } },
    select: { blockHash: true },
  });
  const existingHashes = new Set(existing.map((e) => e.blockHash));
  const freshHashes = blockHashes.filter((h) => !existingHashes.has(h));

  if (freshHashes.length === 0) {
    return { blockId: null, identifierCount: 0 };
  }

  const block = await prisma.block.create({
    data: {
      reason: input.reason,
      identifiers: {
        create: freshHashes.map((blockHash) => ({ blockHash })),
      },
    },
    select: { id: true },
  });

  return { blockId: block.id, identifierCount: freshHashes.length };
}

/**
 * Remove a block by any one of its identifiers. Deletes the whole Block (and
 * its identifiers, via cascade), so removing via any identifier unblocks the
 * person. The route responds with a constant body regardless of match, but the
 * block count still drops on a hit, so this is not a membership oracle defense -
 * it only avoids an extra signal. Returns whether a block matched (audit only).
 */
export async function removeBlock(identifier: string): Promise<boolean> {
  const blockHash = hashBlockValue(
    hashLookupValue(normalizeIdentifier(identifier)),
  );

  const entry = await prisma.blockedIdentifier.findUnique({
    where: { blockHash },
    select: { blockId: true },
  });

  if (!entry) {
    return false;
  }

  await prisma.block.delete({ where: { id: entry.blockId } });
  return true;
}

/** Number of blocks (not their contents) - for admin UI feedback only. */
export async function countBlocks(): Promise<number> {
  return prisma.block.count();
}
