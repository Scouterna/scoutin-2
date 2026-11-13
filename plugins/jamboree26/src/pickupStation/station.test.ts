import { describe, expect, it } from "vitest";
import { pickupStation } from "./station.ts";

const delegate = (delegateNumber: unknown, lastName: unknown = "Andersson") =>
  pickupStation({ participantType: "delegate", lastName, delegateNumber });

const byName = (lastName: unknown, participantType: unknown = "participant") =>
  pickupStation({ participantType, lastName, delegateNumber: undefined });

describe("pickupStation: delegates", () => {
  it.each([
    [1, "Ombud 1-249"],
    [249, "Ombud 1-249"],
    [250, "Ombud 250-500"],
    [500, "Ombud 250-500"],
    [501, "Ombud 501-800"],
    [800, "Ombud 501-800"],
    [" 42 ", "Ombud 1-249"],
    ["42", "Ombud 1-249"],
    [["42"], "Ombud 1-249"],
    [[42], "Ombud 1-249"],
  ])("maps %j to %s", (input, expected) => {
    expect(delegate(input)).toBe(expected);
  });

  it.each([
    0,
    801,
    "12a",
    "",
    undefined,
    null,
    ["1", "2"],
    [],
    "1.5",
    "-3",
  ])("returns null for %j and never falls back to the last name", (input) => {
    expect(delegate(input)).toBeNull();
  });

  it("ignores the last name for a valid number", () => {
    expect(delegate(300, "Zetterberg")).toBe("Ombud 250-500");
  });
});

describe("pickupStation: day visitors", () => {
  it("sends day visitors to their own station", () => {
    expect(byName("Andersson", "dayVisitor")).toBe("Dagsdeltagare");
  });
});

describe("pickupStation: last names", () => {
  it.each([
    ["Andersson", "Övriga Efternamn A-F"],
    ["Fransson", "Övriga Efternamn A-F"],
    ["Gustafsson", "Övriga Efternamn G-K"],
    ["Karlsson", "Övriga Efternamn G-K"],
    ["Larsson", "Övriga Efternamn L-R"],
    ["Rydberg", "Övriga Efternamn L-R"],
    ["Svensson", "Övriga Efternamn S-Ö"],
    ["Zetterberg", "Övriga Efternamn S-Ö"],
    ["Åberg", "Övriga Efternamn S-Ö"],
    ["Ängel", "Övriga Efternamn S-Ö"],
    ["Öberg", "Övriga Efternamn S-Ö"],
    ["Østergaard", "Övriga Efternamn S-Ö"],
    ["Ærø", "Övriga Efternamn S-Ö"],
    ["Émile", "Övriga Efternamn A-F"],
    [" berg", "Övriga Efternamn A-F"],
    ["Üstün", "Övriga Efternamn S-Ö"],
  ])("maps %j to %s", (name, expected) => {
    expect(byName(name)).toBe(expected);
  });

  it.each(["", "1abc", null, undefined, 5])("returns null for %j", (name) => {
    expect(byName(name)).toBeNull();
  });

  it.each([
    "staff",
    "participant",
    "volunteer",
    "office",
    "exhibitor",
    null,
  ])("uses the last name for type %j", (type) => {
    expect(byName("Larsson", type)).toBe("Övriga Efternamn L-R");
  });
});
