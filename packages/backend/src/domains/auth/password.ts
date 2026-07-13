import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// Password hashing with scrypt (node:crypto, no external dependency). Stored
// format is "<saltHex>:<hashHex>". scrypt is deliberately slow/memory-hard,
// unlike the unsalted SHA-256 used elsewhere for random keys - do not reuse
// this for those, or that for passwords.
const scryptAsync = promisify(scrypt);

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = (await scryptAsync(plain, salt, KEY_LENGTH)) as Buffer;
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

export async function verifyPassword(
  plain: string,
  stored: string,
): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const derived = (await scryptAsync(plain, salt, expected.length)) as Buffer;

  // Length guard before timingSafeEqual, which throws on mismatched lengths.
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
