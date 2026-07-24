import { type } from "arktype";

/**
 * The languages a check-in session can be conducted in. Shared by the backend
 * flow engine, step implementations and the kiosk UI so there is a single
 * source of truth for what `{ sv, en }` means.
 */
export const SUPPORTED_LANGUAGES = ["sv", "en"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = "sv";

/** Native names, deliberately never translated. */
export const LANGUAGE_LABELS: Record<Language, string> = {
  sv: "Svenska",
  en: "English",
};

/** Text authored per language in config, e.g. `{ sv: "Tack!", en: "Thanks!" }`. */
export const LocalizedString = type({
  "sv?": "string",
  "en?": "string",
});
export type LocalizedString = typeof LocalizedString.infer;

const supported = new Set<string>(SUPPORTED_LANGUAGES);

export function isSupportedLanguage(value: unknown): value is Language {
  return typeof value === "string" && supported.has(value);
}

export function coerceLanguage(value: unknown): Language {
  return isSupportedLanguage(value) ? value : DEFAULT_LANGUAGE;
}

/**
 * Picks the requested language from a localized map, falling back to Swedish
 * and then to whatever value exists, so a partially translated config never
 * renders an empty string.
 */
export function resolveLocalized(
  map: Record<string, string>,
  language: string,
): string {
  return map[language] ?? map[DEFAULT_LANGUAGE] ?? Object.values(map)[0] ?? "";
}
