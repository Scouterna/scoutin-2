import { describe, expect, it } from "vitest";
import { forType, sample, values } from "./dj26.tsx";

type Values = typeof values.infer;
const input = (participantType: Values["participantType"]): Values => ({
  ...sample,
  participantType,
  participantSubtype: "Kock",
});

describe("forType", () => {
  it("keeps everything for a delegate", () => {
    const v = forType(input("delegate"));
    expect([v.delegateNumber, v.preparationGroup, v.lunchSaturday]).toEqual([
      "512",
      "Bläckfisken – 10",
      "Hajkbanan",
    ]);
    expect(v.participantSubtype).toBeUndefined();
  });
  it("shows the subtype for volunteers only", () => {
    expect(forType(input("volunteer")).participantSubtype).toBe("Kock");
    expect(forType(input("staff")).participantSubtype).toBeUndefined();
  });
  it("shows the delegate number and preparation group for delegates only", () => {
    const v = forType(input("participant"));
    expect(v.delegateNumber).toBeUndefined();
    expect(v.preparationGroup).toBeUndefined();
    expect(v.lunchSaturday).toBe("Hajkbanan");
  });
  it("shows no meals for day visitors", () => {
    const v = forType(input("dayVisitor"));
    expect([v.lunchSaturday, v.lunchSunday, v.dinnerSaturday]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
  it("rejects an unknown type", () => {
    expect(
      values({ ...sample, participantType: "Ombud" }).toString(),
    ).toContain("participantType");
  });
});
