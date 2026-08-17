import { describe, expect, it } from "vitest";
import { InvalidUsernameError, normalizeHardcoverUsername } from "./usernames";

describe("normalizeHardcoverUsername", () => {
  it.each([
    ["adam", "adam"],
    [" Adam ", "adam"],
    ["@Adam", "adam"],
    ["reader_name", "reader_name"],
    ["reader-name", "reader-name"],
    ["reader.name", "reader.name"],
    ["https://hardcover.app/@Adam", "adam"],
    ["https://www.hardcover.app/@Adam/", "adam"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeHardcoverUsername(input)).toBe(expected);
  });

  it.each([
    "",
    "@",
    "not a username",
    "https://example.com/@adam",
    "https://hardcover.app/books/adam",
    `a${"b".repeat(64)}`,
  ])("rejects %s", (input) => {
    expect(() => normalizeHardcoverUsername(input)).toThrow(InvalidUsernameError);
  });
});
