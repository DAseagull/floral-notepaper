import { expect, test } from "vitest";
import { fitPinSize } from "./pinSizing";

test("fits large images to physical screen pixels without distorting aspect", () => {
  expect(fitPinSize(3840, 2160, 1, 1920, 1080)).toEqual({ width: 1920, height: 1080 });
  expect(fitPinSize(800, 600, 0.5, 1920, 1080)).toEqual({ width: 400, height: 300 });
  expect(fitPinSize(1, 2000, 1, 1920, 1080)).toEqual({ width: 1, height: 1080 });
});
test("rejects empty or invalid dimensions", () => {
  expect(() => fitPinSize(0, 10, 1, 1920, 1080)).toThrow();
  expect(() => fitPinSize(10, 10, Infinity, 1920, 1080)).toThrow();
});
