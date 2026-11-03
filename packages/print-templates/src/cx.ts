/**
 * Joins class names, skipping empty ones. Satori applies `tw` classes in the
 * order given and the last one wins, so a caller's classes go last and no
 * conflict merging is needed.
 */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
