import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHELF_THEME,
  resolveShelfTheme,
  SHELF_THEME_COOKIE_MAX_AGE,
  SHELF_THEME_COOKIE_NAME,
} from "./shelf-themes";

describe("shelf theme preferences", () => {
  it.each(["heritage", "pine", "metalBlack"] as const)(
    "accepts the known %s theme",
    (theme) => {
      expect(resolveShelfTheme(theme)).toBe(theme);
    },
  );

  it("falls back safely for absent or unrecognized cookie values", () => {
    expect(resolveShelfTheme(undefined)).toBe(DEFAULT_SHELF_THEME);
    expect(resolveShelfTheme("unknown-theme")).toBe(DEFAULT_SHELF_THEME);
    expect(resolveShelfTheme("toString")).toBe(DEFAULT_SHELF_THEME);
  });

  it("uses a stable, one-year preference cookie", () => {
    expect(SHELF_THEME_COOKIE_NAME).toBe("hardcover-shelf-theme");
    expect(SHELF_THEME_COOKIE_MAX_AGE).toBe(31_536_000);
  });
});
