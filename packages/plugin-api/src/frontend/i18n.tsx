import { createContext, useContext } from "react";
import { coerceLanguage, DEFAULT_LANGUAGE, type Language } from "../i18n.ts";

/**
 * The session language, provided by the app shell around every screen. Screens
 * that need to localize their *own* hardcoded strings read it through
 * `useTranslations`; text that comes from the step config is already resolved
 * server-side and needs nothing here.
 */
export const LanguageContext = createContext<Language>(DEFAULT_LANGUAGE);

export function useLanguage(): Language {
  return useContext(LanguageContext);
}

export type Dictionary = Record<Language, Record<string, string>>;

export type Translate<D extends Dictionary> = (
  key: keyof D[typeof DEFAULT_LANGUAGE],
  vars?: Record<string, string | number>,
) => string;

function interpolate(
  template: string,
  vars: Record<string, string | number> | undefined,
): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    name in vars ? String(vars[name]) : match,
  );
}

/**
 * Dictionary-driven translation for a component's own strings:
 *
 * ```tsx
 * const dict = {
 *   sv: { title: "Skanna ditt kort" },
 *   en: { title: "Scan your card" },
 * };
 * const t = useTranslations(dict);
 * return <h1>{t("title")}</h1>;
 * ```
 *
 * Falls back to Swedish, then to the key itself, so a missing translation
 * degrades to readable text rather than an empty node.
 */
export function useTranslations<D extends Dictionary>(dict: D): Translate<D> {
  const language = coerceLanguage(useLanguage());

  return (key, vars) => {
    const name = String(key);
    const template =
      dict[language]?.[name] ?? dict[DEFAULT_LANGUAGE]?.[name] ?? name;
    return interpolate(template, vars);
  };
}
