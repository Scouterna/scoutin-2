/**
 * Localized text resolution.
 *
 * Step config text may be authored either as a plain string (single language)
 * or as a `{ sv: "...", en: "..." }` map. Rather than making every step
 * declare a localized input type, the flow engine collapses these maps to a
 * single string for the session's language before the step ever sees its
 * inputs - so a step declaring `title: "string"` transparently supports both
 * forms. See `resolveLocalizedDeep` and `getCurrentStep`.
 */

import {
  resolveLocalized,
  SUPPORTED_LANGUAGES,
} from "@scouterna/scoutin-plugin-api/backend";

export {
  coerceLanguage,
  DEFAULT_LANGUAGE,
  isSupportedLanguage,
  type Language,
  resolveLocalized,
  SUPPORTED_LANGUAGES,
} from "@scouterna/scoutin-plugin-api/backend";

const supported = new Set<string>(SUPPORTED_LANGUAGES);

/**
 * A localized string map is a plain object whose keys are *all* supported
 * language codes and whose values are all strings. The all-keys-known
 * requirement is what keeps this from misfiring on ordinary config objects
 * (e.g. a diet-flag map, or `{ sv: 1 }`).
 */
export function isLocalizedString(
  value: unknown,
): value is Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const entries = Object.entries(value);
  if (entries.length === 0) return false;

  return entries.every(
    ([key, val]) => supported.has(key) && typeof val === "string",
  );
}

/**
 * Deep-walks objects and arrays, replacing every localized string map with the
 * resolved string for `language`. Everything else is returned untouched.
 */
export function resolveLocalizedDeep<T>(value: T, language: string): unknown {
  if (isLocalizedString(value)) {
    return resolveLocalized(value, language);
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveLocalizedDeep(item, language));
  }

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = resolveLocalizedDeep(val, language);
    }
    return result;
  }

  return value;
}

/** Object-preserving wrapper for the common `with`-block case. */
export function resolveLocalizedInputs(
  inputs: Record<string, unknown>,
  language: string,
): Record<string, unknown> {
  return resolveLocalizedDeep(inputs, language) as Record<string, unknown>;
}
