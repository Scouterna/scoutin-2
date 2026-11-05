import { describe, expect, it } from "vitest";
import { showBackButton } from "./backButton";

describe("showBackButton", () => {
  describe("kiosk", () => {
    it("shows when a go-back is allowed and the step is not locked", () => {
      expect(
        showBackButton({
          locked: false,
          canGoBack: true,
          historyLength: 0,
          staff: false,
        }),
      ).toBe(true);
    });

    it("hides when the step is locked, even with screen history", () => {
      expect(
        showBackButton({
          locked: true,
          canGoBack: true,
          historyLength: 2,
          staff: false,
        }),
      ).toBe(false);
    });

    it("hides when a barrier refuses go-back and there is no screen history", () => {
      expect(
        showBackButton({
          locked: false,
          canGoBack: false,
          historyLength: 0,
          staff: false,
        }),
      ).toBe(false);
    });

    it("shows for within-step screen history when a barrier blocks go-back", () => {
      expect(
        showBackButton({
          locked: false,
          canGoBack: false,
          historyLength: 1,
          staff: false,
        }),
      ).toBe(true);
    });
  });

  describe("staff", () => {
    it("shows when a go-back is allowed and not locked", () => {
      expect(
        showBackButton({
          locked: false,
          canGoBack: true,
          historyLength: 0,
          staff: true,
        }),
      ).toBe(true);
    });

    it("stays visible when locked, since staff can override the lock", () => {
      expect(
        showBackButton({
          locked: true,
          canGoBack: true,
          historyLength: 0,
          staff: true,
        }),
      ).toBe(true);
    });

    it("hides when a barrier refuses go-back and there is no screen history", () => {
      expect(
        showBackButton({
          locked: true,
          canGoBack: false,
          historyLength: 0,
          staff: true,
        }),
      ).toBe(false);
    });

    it("shows for within-step screen history when a barrier blocks go-back", () => {
      expect(
        showBackButton({
          locked: false,
          canGoBack: false,
          historyLength: 3,
          staff: true,
        }),
      ).toBe(true);
    });
  });
});
