import { describe, expect, test } from "vitest";
import { normalizeTransparency, transparencyStyle } from "./transparency";

describe("background transparency", () => {
  test("keeps legacy settings opaque and clamps malformed values", () => {
    for (const value of [undefined, null, NaN, Infinity, "100"])
      expect(normalizeTransparency(value)).toBe(0);
    expect(normalizeTransparency(-10)).toBe(0);
    expect(normalizeTransparency(130)).toBe(100);
    expect(normalizeTransparency(49.7)).toBe(50);
  });
  test("changes a background variable without fading content", () => {
    expect(transparencyStyle(0)).toEqual({ "--surface-opacity": 1 });
    expect(transparencyStyle(50)).toEqual({ "--surface-opacity": 0.5 });
    expect(transparencyStyle(100)).toEqual({ "--surface-opacity": 0 });
    expect(transparencyStyle(100)).not.toHaveProperty("opacity");
  });
});
