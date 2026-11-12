import { describe, expect, it } from "vitest";
import { hashSecret, readBearerToken } from "./secrets.ts";

describe("hashSecret", () => {
  it("is the SHA-256 hex digest", () => {
    expect(hashSecret("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("readBearerToken", () => {
  it("reads the token", () => {
    expect(readBearerToken("Bearer sci_abc")).toBe("sci_abc");
  });

  it("rejects a missing header, another scheme and an empty token", () => {
    expect(readBearerToken(undefined)).toBeNull();
    expect(readBearerToken("Basic abc")).toBeNull();
    expect(readBearerToken("Bearer ")).toBeNull();
  });
});
