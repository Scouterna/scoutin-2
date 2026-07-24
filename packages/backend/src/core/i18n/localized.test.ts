import { describe, expect, it } from "vitest";
import {
  coerceLanguage,
  isLocalizedString,
  resolveLocalized,
  resolveLocalizedDeep,
} from "./localized.ts";

describe("isLocalizedString", () => {
  it("accepts maps whose keys are all supported languages", () => {
    expect(isLocalizedString({ sv: "Hej", en: "Hi" })).toBe(true);
    expect(isLocalizedString({ sv: "Hej" })).toBe(true);
    expect(isLocalizedString({ en: "Hi" })).toBe(true);
  });

  it("rejects anything that isn't purely a language map", () => {
    expect(isLocalizedString({ sv: "Hej", nb: "Hei" })).toBe(false);
    expect(isLocalizedString({ sv: 1 })).toBe(false);
    expect(isLocalizedString({ dietMjolkprotein: "Mjölkprotein" })).toBe(false);
    expect(isLocalizedString({})).toBe(false);
    expect(isLocalizedString(["sv"])).toBe(false);
    expect(isLocalizedString(null)).toBe(false);
    expect(isLocalizedString("sv")).toBe(false);
  });
});

describe("resolveLocalized", () => {
  it("picks the requested language", () => {
    expect(resolveLocalized({ sv: "Hej", en: "Hi" }, "en")).toBe("Hi");
  });

  it("falls back to Swedish, then to any available value", () => {
    expect(resolveLocalized({ sv: "Hej" }, "en")).toBe("Hej");
    expect(resolveLocalized({ en: "Hi" }, "nb")).toBe("Hi");
  });
});

describe("resolveLocalizedDeep", () => {
  it("collapses maps nested in objects and arrays", () => {
    const input = {
      title: { sv: "Tack!", en: "Thanks!" },
      message: "Plain",
      nested: { description: { sv: "Beskrivning", en: "Description" } },
      items: [{ label: { sv: "Ett", en: "One" } }, "raw"],
    };

    expect(resolveLocalizedDeep(input, "en")).toEqual({
      title: "Thanks!",
      message: "Plain",
      nested: { description: "Description" },
      items: [{ label: "One" }, "raw"],
    });
  });

  it("leaves non-locale objects and primitives untouched", () => {
    const input = {
      dataSources: ["groups"],
      safeFromHarmValidYears: 3,
      hideCallout: true,
      labels: { dietMjolkprotein: "Mjölkprotein" },
      missing: null,
      absent: undefined,
    };

    expect(resolveLocalizedDeep(input, "en")).toEqual(input);
  });

  it("handles nullish input", () => {
    expect(resolveLocalizedDeep(null, "en")).toBe(null);
    expect(resolveLocalizedDeep(undefined, "en")).toBe(undefined);
  });
});

describe("coerceLanguage", () => {
  it("passes through supported languages and defaults otherwise", () => {
    expect(coerceLanguage("en")).toBe("en");
    expect(coerceLanguage("sv")).toBe("sv");
    expect(coerceLanguage("nb")).toBe("sv");
    expect(coerceLanguage(undefined)).toBe("sv");
  });
});
