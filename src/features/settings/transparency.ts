import type { CSSProperties } from "react";

export function normalizeTransparency(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(Math.min(100, Math.max(0, value)))
    : 0;
}

export function transparencyStyle(value: unknown): CSSProperties {
  return { "--surface-opacity": 1 - normalizeTransparency(value) / 100 } as CSSProperties;
}
