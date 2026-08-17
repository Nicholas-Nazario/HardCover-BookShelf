// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  bookPresentationStorageKey,
  loadBookPresentationPreferences,
  saveBookPresentationPreferences,
} from "./book-presentations";

afterEach(() => localStorage.clear());

describe("book presentation preferences", () => {
  it("stores spine overrides per normalized profile and omits default covers", () => {
    expect(
      saveBookPresentationPreferences(localStorage, " Adam ", {
        1: "spine",
        2: "cover",
      }),
    ).toBe(true);

    expect(
      localStorage.getItem(bookPresentationStorageKey("adam")),
    ).toBe('{"1":"spine"}');
    expect(loadBookPresentationPreferences(localStorage, "ADAM")).toEqual({
      1: "spine",
    });
    expect(loadBookPresentationPreferences(localStorage, "another-user")).toEqual(
      {},
    );
  });

  it("ignores malformed storage and invalid book preferences", () => {
    localStorage.setItem(bookPresentationStorageKey("adam"), "not json");
    expect(loadBookPresentationPreferences(localStorage, "adam")).toEqual({});

    localStorage.setItem(
      bookPresentationStorageKey("adam"),
      JSON.stringify({
        0: "spine",
        1: "sideways",
        2: "cover",
        3: "spine",
        nope: "spine",
      }),
    );
    expect(loadBookPresentationPreferences(localStorage, "adam")).toEqual({
      2: "cover",
      3: "spine",
    });
  });

  it("does not throw when browser storage is unavailable", () => {
    const unavailableStorage = {
      getItem: () => {
        throw new DOMException("Unavailable");
      },
      setItem: () => {
        throw new DOMException("Unavailable");
      },
    };

    expect(loadBookPresentationPreferences(unavailableStorage, "adam")).toEqual(
      {},
    );
    expect(
      saveBookPresentationPreferences(unavailableStorage, "adam", {
        1: "spine",
      }),
    ).toBe(false);
  });
});
