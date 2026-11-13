import { describe, expect, it } from "vitest";
import { sameSettingValue } from "./profileValues";

describe("sameSettingValue", () => {
  it("matches equal strings", () => {
    expect(sameSettingValue("abc", "abc")).toBe(true);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(sameSettingValue("Auto", "auto")).toBe(true);
    expect(sameSettingValue("  on ", "ON")).toBe(true);
  });

  it("compares numbers numerically", () => {
    expect(sameSettingValue("15", "15.0")).toBe(true);
    expect(sameSettingValue(" 2 ", "2.00")).toBe(true);
  });

  it("treats different numbers as different", () => {
    expect(sameSettingValue("15", "16")).toBe(false);
  });

  it("treats a number and text as different", () => {
    expect(sameSettingValue("15", "fifteen")).toBe(false);
    expect(sameSettingValue("0", "off")).toBe(false);
  });

  it("handles empty strings", () => {
    expect(sameSettingValue("", "")).toBe(true);
    expect(sameSettingValue("", "  ")).toBe(true);
    expect(sameSettingValue("", "0")).toBe(false);
    expect(sameSettingValue("", "x")).toBe(false);
  });
});
