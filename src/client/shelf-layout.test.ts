// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { bookPresentationStorageKey } from "./book-presentations";
import {
  addBookToHorizontalStack,
  createShelfLayout,
  createHorizontalBookStack,
  loadOrCreateShelfLayout,
  loadShelfLayout,
  moveShelfItem,
  reconcileShelfLayout,
  removeBookFromHorizontalStack,
  removeBookFromHorizontalStackToRowEnd,
  saveShelfLayout,
  shelfLayoutStorageKey,
  updateBookPresentation,
  unstackHorizontalBookStack,
  type BookShelfItem,
  type ShelfLayout,
} from "./shelf-layout";

afterEach(() => localStorage.clear());

const bookIds = { read: [1, 2], wantToRead: [3] };

describe("shelf layout", () => {
  it("creates a versioned variable-width layout from the imported books", () => {
    const layout = createShelfLayout(bookIds, { 2: "spine" });

    expect(layout).toEqual({
      version: 1,
      shelves: {
        read: {
          stacks: {},
          rows: [{ id: "row:read:0", items: ["book:1", "book:2"] }],
          items: {
            "book:1": expect.objectContaining({
              kind: "book",
              bookId: 1,
              widthUnits: 1,
              presentation: "cover",
              orientation: "vertical",
            }),
            "book:2": expect.objectContaining({ presentation: "spine" }),
          },
        },
        wantToRead: {
          stacks: {},
          rows: [{ id: "row:wantToRead:0", items: ["book:3"] }],
          items: {
            "book:3": expect.objectContaining({ bookId: 3 }),
          },
        },
      },
    });
  });

  it("migrates existing presentation preferences only when no layout exists", () => {
    localStorage.setItem(bookPresentationStorageKey(" Adam "), '{"2":"spine"}');

    const initialLayout = loadOrCreateShelfLayout(localStorage, "adam", bookIds);
    expect(bookItem(initialLayout, "read", 2).presentation).toBe(
      "spine",
    );

    const savedLayout = createShelfLayout(bookIds);
    bookItem(savedLayout, "read", 2).orientation = "horizontal";
    expect(saveShelfLayout(localStorage, "adam", savedLayout)).toBe(true);

    const restoredLayout = loadOrCreateShelfLayout(localStorage, "ADAM", bookIds);
    expect(bookItem(restoredLayout, "read", 2).presentation).toBe(
      "cover",
    );
    expect(bookItem(restoredLayout, "read", 2).orientation).toBe(
      "horizontal",
    );
  });

  it("uses a normalized username-specific storage key", () => {
    expect(shelfLayoutStorageKey(" Adam ")).toBe(shelfLayoutStorageKey("adam"));
    expect(shelfLayoutStorageKey("adam")).not.toBe(shelfLayoutStorageKey("eve"));
  });

  it("rejects malformed and structurally invalid stored layouts", () => {
    localStorage.setItem(shelfLayoutStorageKey("adam"), "not json");
    expect(loadShelfLayout(localStorage, "adam")).toBeNull();

    localStorage.setItem(
      shelfLayoutStorageKey("adam"),
      JSON.stringify({ version: 2, shelves: {} }),
    );
    expect(loadShelfLayout(localStorage, "adam")).toBeNull();

    const layout = createShelfLayout(bookIds);
    layout.shelves.read.items["book:1"]!.widthUnits = 0.3;
    localStorage.setItem(shelfLayoutStorageKey("adam"), JSON.stringify(layout));
    expect(loadShelfLayout(localStorage, "adam")).toBeNull();

    const duplicateItemLayout = createShelfLayout(bookIds);
    duplicateItemLayout.shelves.read.rows[0]!.items.push("book:1");
    localStorage.setItem(
      shelfLayoutStorageKey("adam"),
      JSON.stringify(duplicateItemLayout),
    );
    expect(loadShelfLayout(localStorage, "adam")).toBeNull();

    const mismatchedRowLayout = createShelfLayout(bookIds);
    bookItem(mismatchedRowLayout, "read", 1).rowId = "row:wantToRead:0";
    localStorage.setItem(
      shelfLayoutStorageKey("adam"),
      JSON.stringify(mismatchedRowLayout),
    );
    expect(loadShelfLayout(localStorage, "adam")).toBeNull();
  });

  it("reconciles a saved scene without losing valid non-book items", () => {
    const layout = createShelfLayout(bookIds);
    const row = layout.shelves.read.rows[0]!;
    layout.shelves.read.items.gap = {
      id: "gap",
      kind: "spacer",
      rowId: row.id,
      widthUnits: 0.75,
    };
    row.items.splice(1, 0, "gap");
    bookItem(layout, "read", 1).orientation = "horizontal";

    const reconciled = reconcileShelfLayout(layout, {
      read: [1, 4],
      wantToRead: [],
    });

    expect(reconciled.shelves.read.rows[0]?.items).toEqual([
      "book:1",
      "gap",
      "book:4",
    ]);
    expect(bookItem(reconciled, "read", 1).orientation).toBe("horizontal");
    expect(reconciled.shelves.read.items.gap).toEqual(
      expect.objectContaining({ kind: "spacer", widthUnits: 0.75 }),
    );
    expect(reconciled.shelves.read.items["book:2"]).toBeUndefined();
    expect(reconciled.shelves.wantToRead.rows[0]?.items).toEqual([]);
  });

  it("updates a book presentation without mutating the stored scene", () => {
    const layout = createShelfLayout(bookIds);
    const updatedLayout = updateBookPresentation(layout, 2, "spine");

    expect(bookItem(layout, "read", 2).presentation).toBe("cover");
    expect(bookItem(updatedLayout, "read", 2).presentation).toBe("spine");
    expect(updatedLayout.shelves.wantToRead).toBe(layout.shelves.wantToRead);
  });

  it("builds a non-mutating insertion preview when a book moves over another", () => {
    const layout = createShelfLayout(bookIds);
    const preview = moveShelfItem(layout, "read", "book:2", "book:1");

    expect(layout.shelves.read.rows[0]?.items).toEqual(["book:1", "book:2"]);
    expect(preview.shelves.read.rows[0]?.items).toEqual(["book:2", "book:1"]);
  });

  it("replaces selected row placements with one ordered horizontal stack", () => {
    const layout = createShelfLayout(bookIds);
    layout.shelves.read.rows[0]!.items = ["book:2", "book:1"];
    const stacked = createHorizontalBookStack(layout, "read", ["book:1", "book:2"]);

    expect(stacked.shelves.read.rows[0]?.items).toEqual(["stack:1"]);
    expect(Object.values(stacked.shelves.read.stacks)).toEqual([
      {
        id: "1",
        rowId: "row:read:0",
        bookItemIds: ["book:2", "book:1"],
      },
    ]);
    expect(bookItem(stacked, "read", 1).orientation).toBe("horizontal");
    expect(bookItem(stacked, "read", 2).orientation).toBe("horizontal");
    expect(layout.shelves.read.rows[0]?.items).toEqual(["book:2", "book:1"]);
    expect(bookItem(layout, "read", 1).orientation).toBe("vertical");
  });

  it("reloads a stack with member books excluded from normal row placement", () => {
    const stacked = createHorizontalBookStack(
      createShelfLayout(bookIds),
      "read",
      ["book:1", "book:2"],
    );

    expect(saveShelfLayout(localStorage, "adam", stacked)).toBe(true);
    const restored = loadOrCreateShelfLayout(localStorage, "adam", bookIds);

    expect(restored.shelves.read.rows[0]?.items).toEqual(["stack:1"]);
    expect(restored.shelves.read.stacks["1"]?.bookItemIds).toEqual([
      "book:1",
      "book:2",
    ]);
  });

  it("moves a stack placement as one unit", () => {
    const stacked = createHorizontalBookStack(
      createShelfLayout({ read: [1, 2, 4], wantToRead: [] }),
      "read",
      ["book:2", "book:4"],
    );
    const moved = moveShelfItem(stacked, "read", "stack:1", "book:1");

    expect(moved.shelves.read.rows[0]?.items).toEqual(["stack:1", "book:1"]);
    expect(moved.shelves.read.stacks["1"]?.bookItemIds).toEqual([
      "book:2",
      "book:4",
    ]);
  });

  it("unstacks members in order at the stack placement", () => {
    const layout = createShelfLayout({ read: [1, 2, 4], wantToRead: [] });
    layout.shelves.read.rows[0]!.items = ["book:4", "book:2", "book:1"];
    const stacked = createHorizontalBookStack(layout, "read", ["book:2", "book:1"]);
    const unstacked = unstackHorizontalBookStack(stacked, "read", "1");

    expect(stacked.shelves.read.rows[0]?.items).toEqual(["book:4", "stack:1"]);
    expect(unstacked.shelves.read.rows[0]?.items).toEqual([
      "book:4",
      "book:2",
      "book:1",
    ]);
    expect(unstacked.shelves.read.stacks).toEqual({});
    expect(bookItem(unstacked, "read", 1).orientation).toBe("horizontal");
    expect(bookItem(unstacked, "read", 2).orientation).toBe("horizontal");
  });

  it("adds only an unstacked horizontal book at the resolved member position", () => {
    const stacked = createHorizontalBookStack(
      createShelfLayout({ read: [1, 2, 4], wantToRead: [] }),
      "read",
      ["book:1", "book:2"],
    );

    expect(
      addBookToHorizontalStack(stacked, "read", "1", "book:4", 1),
    ).toBe(stacked);

    bookItem(stacked, "read", 4).orientation = "horizontal";
    const added = addBookToHorizontalStack(
      stacked,
      "read",
      "1",
      "book:4",
      1,
    );

    expect(added.shelves.read.rows[0]?.items).toEqual(["stack:1"]);
    expect(added.shelves.read.stacks["1"]?.bookItemIds).toEqual([
      "book:1",
      "book:4",
      "book:2",
    ]);
    expect(stacked.shelves.read.rows[0]?.items).toEqual([
      "stack:1",
      "book:4",
    ]);
  });

  it("removes a member to a row placement and preserves the remaining stack order", () => {
    const layout = createShelfLayout({ read: [1, 2, 4, 5], wantToRead: [] });
    const stacked = createHorizontalBookStack(
      layout,
      "read",
      ["book:1", "book:2", "book:4"],
    );
    const removed = removeBookFromHorizontalStack(
      stacked,
      "read",
      "1",
      "book:2",
      "book:5",
    );

    expect(removed.shelves.read.rows[0]?.items).toEqual([
      "stack:1",
      "book:2",
      "book:5",
    ]);
    expect(removed.shelves.read.stacks["1"]?.bookItemIds).toEqual([
      "book:1",
      "book:4",
    ]);
    expect(bookItem(removed, "read", 2)).toEqual(
      expect.objectContaining({ rowId: "row:read:0", orientation: "horizontal" }),
    );
  });

  it("automatically dissolves a stack when one member remains", () => {
    const stacked = createHorizontalBookStack(
      createShelfLayout({ read: [1, 2, 4], wantToRead: [] }),
      "read",
      ["book:1", "book:2"],
    );
    const removed = removeBookFromHorizontalStack(
      stacked,
      "read",
      "1",
      "book:1",
      "book:4",
    );

    expect(removed.shelves.read.rows[0]?.items).toEqual([
      "book:2",
      "book:1",
      "book:4",
    ]);
    expect(removed.shelves.read.stacks).toEqual({});
    expect(bookItem(removed, "read", 2).orientation).toBe("horizontal");
  });

  it("can remove a member at the row end when the stack is the only placement", () => {
    const stacked = createHorizontalBookStack(
      createShelfLayout({ read: [1, 2], wantToRead: [] }),
      "read",
      ["book:1", "book:2"],
    );
    const removed = removeBookFromHorizontalStackToRowEnd(
      stacked,
      "read",
      "1",
      "book:1",
      "row:read:0",
    );

    expect(removed.shelves.read.rows[0]?.items).toEqual([
      "book:2",
      "book:1",
    ]);
    expect(removed.shelves.read.stacks).toEqual({});
    expect(bookItem(removed, "read", 1).orientation).toBe("horizontal");
  });

  it("persists exact stack edits through reconciliation and reload", () => {
    let layout = createHorizontalBookStack(
      createShelfLayout({ read: [1, 2, 4], wantToRead: [] }),
      "read",
      ["book:1", "book:2"],
    );
    bookItem(layout, "read", 4).orientation = "horizontal";
    layout = addBookToHorizontalStack(layout, "read", "1", "book:4", 1);

    expect(saveShelfLayout(localStorage, "adam", layout)).toBe(true);
    const restored = loadOrCreateShelfLayout(localStorage, "adam", {
      read: [1, 2, 4],
      wantToRead: [],
    });

    expect(restored.shelves.read.rows[0]?.items).toEqual(["stack:1"]);
    expect(restored.shelves.read.stacks["1"]?.bookItemIds).toEqual([
      "book:1",
      "book:4",
      "book:2",
    ]);
  });

  it("dissolves a refreshed stack in place when one imported member remains", () => {
    const stacked = createHorizontalBookStack(
      createShelfLayout({ read: [1, 2], wantToRead: [] }),
      "read",
      ["book:1", "book:2"],
    );
    const reconciled = reconcileShelfLayout(stacked, {
      read: [2, 4],
      wantToRead: [],
    });

    expect(reconciled.shelves.read.rows[0]?.items).toEqual([
      "book:2",
      "book:4",
    ]);
    expect(reconciled.shelves.read.stacks).toEqual({});
    expect(bookItem(reconciled, "read", 2).orientation).toBe("horizontal");
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
    const layout: ShelfLayout = createShelfLayout(bookIds);

    expect(loadShelfLayout(unavailableStorage, "adam")).toBeNull();
    expect(saveShelfLayout(unavailableStorage, "adam", layout)).toBe(false);
  });
});

function bookItem(
  layout: ShelfLayout,
  shelf: "read" | "wantToRead",
  bookId: number,
): BookShelfItem {
  const item = layout.shelves[shelf].items[`book:${bookId}`];

  if (!item || item.kind !== "book") {
    throw new Error(`Expected book ${bookId} on ${shelf}.`);
  }

  return item;
}
