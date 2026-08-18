import {
  type BookPresentation,
  type BookPresentationPreferences,
  loadBookPresentationPreferences,
} from "./book-presentations";

export type ShelfLayoutShelfName = "read" | "wantToRead";
export type ShelfItemKind = "book" | "spacer" | "decor";
export type BookOrientation = "vertical" | "horizontal";

export interface ShelfRow {
  id: string;
  items: string[];
}

interface BaseShelfItem {
  id: string;
  rowId: string;
  widthUnits: number;
}

export interface BookShelfItem extends BaseShelfItem {
  kind: "book";
  bookId: number;
  presentation: BookPresentation;
  orientation: BookOrientation;
}

export interface SpacerShelfItem extends BaseShelfItem {
  kind: "spacer";
  heightUnits?: number;
}

export interface DecorShelfItem extends BaseShelfItem {
  kind: "decor";
  assetId: string;
  heightUnits: number;
}

export type ShelfItem = BookShelfItem | SpacerShelfItem | DecorShelfItem;

export interface ShelfSceneLayout {
  rows: ShelfRow[];
  items: Record<string, ShelfItem>;
}

export interface ShelfLayout {
  version: 1;
  shelves: Record<ShelfLayoutShelfName, ShelfSceneLayout>;
}

export interface ShelfBookIds {
  read: readonly number[];
  wantToRead: readonly number[];
}

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem">;

const STORAGE_PREFIX = "hardcover-shelf:layout:v1:";
const DEFAULT_BOOK_WIDTH_UNITS = 1;

export function shelfLayoutStorageKey(username: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(username.trim().toLowerCase())}`;
}

export function createShelfLayout(
  bookIds: ShelfBookIds,
  presentations: BookPresentationPreferences = {},
): ShelfLayout {
  return {
    version: 1,
    shelves: {
      read: createScene("read", bookIds.read, presentations),
      wantToRead: createScene("wantToRead", bookIds.wantToRead, presentations),
    },
  };
}

export function reconcileShelfLayout(
  layout: ShelfLayout,
  bookIds: ShelfBookIds,
): ShelfLayout {
  return {
    version: 1,
    shelves: {
      read: reconcileScene(layout.shelves.read, "read", bookIds.read),
      wantToRead: reconcileScene(
        layout.shelves.wantToRead,
        "wantToRead",
        bookIds.wantToRead,
      ),
    },
  };
}

export function updateBookPresentation(
  layout: ShelfLayout,
  bookId: number,
  presentation: BookPresentation,
): ShelfLayout {
  const itemId = bookItemId(bookId);
  let changed = false;
  const shelves = {} as ShelfLayout["shelves"];

  for (const shelf of ["read", "wantToRead"] as const) {
    const scene = layout.shelves[shelf];
    const item = scene.items[itemId];

    if (!item || item.kind !== "book" || item.presentation === presentation) {
      shelves[shelf] = scene;
      continue;
    }

    changed = true;
    shelves[shelf] = {
      ...scene,
      items: {
        ...scene.items,
        [itemId]: { ...item, presentation },
      },
    };
  }

  return changed ? { ...layout, shelves } : layout;
}

export function moveShelfItem(
  layout: ShelfLayout,
  shelf: ShelfLayoutShelfName,
  activeItemId: string,
  overItemId: string,
): ShelfLayout {
  if (activeItemId === overItemId) return layout;
  const scene = layout.shelves[shelf];
  const sourceRow = scene.rows.find((row) => row.items.includes(activeItemId));
  const targetRow = scene.rows.find((row) => row.items.includes(overItemId));
  const item = scene.items[activeItemId];
  if (!sourceRow || !targetRow || !item) return layout;
  const sourceItems = sourceRow.items.filter((id) => id !== activeItemId);
  const targetItems = sourceRow === targetRow ? sourceItems : [...targetRow.items];
  const targetIndex = targetItems.indexOf(overItemId);
  if (targetIndex < 0) return layout;
  targetItems.splice(targetIndex, 0, activeItemId);
  const rows = scene.rows.map((row) =>
    row.id === sourceRow.id && row.id === targetRow.id
      ? { ...row, items: targetItems }
      : row.id === sourceRow.id
        ? { ...row, items: sourceItems }
        : row.id === targetRow.id
          ? { ...row, items: targetItems }
          : row,
  );
  return {
    ...layout,
    shelves: {
      ...layout.shelves,
      [shelf]: {
        ...scene,
        rows,
        items: { ...scene.items, [activeItemId]: { ...item, rowId: targetRow.id } },
      },
    },
  };
}

export function loadShelfLayout(
  storage: StorageReader,
  username: string,
): ShelfLayout | null {
  try {
    const stored = storage.getItem(shelfLayoutStorageKey(username));

    if (!stored) {
      return null;
    }

    return parseShelfLayout(stored);
  } catch {
    return null;
  }
}

export function loadOrCreateShelfLayout(
  storage: StorageReader,
  username: string,
  bookIds: ShelfBookIds,
): ShelfLayout {
  const storedLayout = loadShelfLayout(storage, username);

  if (storedLayout) {
    return reconcileShelfLayout(storedLayout, bookIds);
  }

  return createShelfLayout(
    bookIds,
    loadBookPresentationPreferences(storage, username),
  );
}

export function saveShelfLayout(
  storage: StorageWriter,
  username: string,
  layout: ShelfLayout,
): boolean {
  if (!isShelfLayout(layout)) {
    return false;
  }

  try {
    storage.setItem(shelfLayoutStorageKey(username), JSON.stringify(layout));
    return true;
  } catch {
    return false;
  }
}

function createScene(
  shelf: ShelfLayoutShelfName,
  rawBookIds: readonly number[],
  presentations: BookPresentationPreferences,
): ShelfSceneLayout {
  const rowId = initialRowId(shelf);
  const items = Object.fromEntries(
    uniqueBookIds(rawBookIds).map((bookId) => {
      const item = createBookItem(bookId, rowId, presentations[bookId]);
      return [item.id, item];
    }),
  );

  return {
    rows: [
      {
        id: rowId,
        items: Object.keys(items),
      },
    ],
    items,
  };
}

function reconcileScene(
  scene: ShelfSceneLayout,
  shelf: ShelfLayoutShelfName,
  rawBookIds: readonly number[],
): ShelfSceneLayout {
  const expectedBookIds = new Set(uniqueBookIds(rawBookIds));
  const items: Record<string, ShelfItem> = {};
  const rows = scene.rows.map((row) => ({ ...row, items: [...row.items] }));

  for (const [itemId, item] of Object.entries(scene.items)) {
    if (item.kind !== "book" || expectedBookIds.has(item.bookId)) {
      items[itemId] = { ...item };
    }
  }

  const knownBookIds = new Set(
    Object.values(items)
      .filter((item): item is BookShelfItem => item.kind === "book")
      .map((item) => item.bookId),
  );
  const retainedItemIds = new Set(Object.keys(items));

  for (const row of rows) {
    row.items = row.items.filter((itemId) => retainedItemIds.has(itemId));
  }

  const destinationRow = rows.at(-1) ?? {
    id: initialRowId(shelf),
    items: [],
  };

  if (rows.length === 0) {
    rows.push(destinationRow);
  }

  for (const bookId of expectedBookIds) {
    if (knownBookIds.has(bookId)) {
      continue;
    }

    const item = createBookItem(bookId, destinationRow.id);
    items[item.id] = item;
    destinationRow.items.push(item.id);
  }

  return { rows, items };
}

function createBookItem(
  bookId: number,
  rowId: string,
  presentation: BookPresentation = "cover",
): BookShelfItem {
  return {
    id: bookItemId(bookId),
    kind: "book",
    rowId,
    widthUnits: DEFAULT_BOOK_WIDTH_UNITS,
    bookId,
    presentation,
    orientation: "vertical",
  };
}

function parseShelfLayout(stored: string): ShelfLayout | null {
  try {
    const parsed: unknown = JSON.parse(stored);
    return isShelfLayout(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isShelfLayout(value: unknown): value is ShelfLayout {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.shelves)) {
    return false;
  }

  return (
    isShelfSceneLayout(value.shelves.read) &&
    isShelfSceneLayout(value.shelves.wantToRead)
  );
}

function isShelfSceneLayout(value: unknown): value is ShelfSceneLayout {
  if (!isRecord(value) || !Array.isArray(value.rows) || !isRecord(value.items)) {
    return false;
  }

  const rowIds = new Set<string>();
  const itemIds = new Set<string>();
  const itemRows = new Map<string, string>();

  for (const row of value.rows) {
    if (
      !isRecord(row) ||
      typeof row.id !== "string" ||
      row.id.length === 0 ||
      rowIds.has(row.id)
    ) {
      return false;
    }

    const rowItems = row.items;
    if (!Array.isArray(rowItems) || !isStringIdList(rowItems, itemIds)) {
      return false;
    }

    rowIds.add(row.id);
    for (const itemId of rowItems) {
      itemIds.add(itemId);
      itemRows.set(itemId, row.id);
    }
  }

  const entries = Object.entries(value.items);
  if (entries.length !== itemIds.size) {
    return false;
  }

  return entries.every(([itemId, item]) =>
    itemIds.has(itemId) &&
    isShelfItem(item, itemId, rowIds) &&
    item.rowId === itemRows.get(itemId),
  );
}

function isStringIdList(value: unknown[], existingIds: ReadonlySet<string>): boolean {
  const rowItemIds = new Set<string>();

  for (const itemId of value) {
    if (
      typeof itemId !== "string" ||
      itemId.length === 0 ||
      existingIds.has(itemId) ||
      rowItemIds.has(itemId)
    ) {
      return false;
    }

    rowItemIds.add(itemId);
  }

  return true;
}

function isShelfItem(
  value: unknown,
  itemId: string,
  rowIds: ReadonlySet<string>,
): value is ShelfItem {
  if (
    !isRecord(value) ||
    value.id !== itemId ||
    typeof value.rowId !== "string" ||
    !rowIds.has(value.rowId) ||
    !isLayoutUnit(value.widthUnits)
  ) {
    return false;
  }

  if (value.kind === "book") {
    return (
      isBookId(value.bookId) &&
      (value.presentation === "cover" || value.presentation === "spine") &&
      (value.orientation === "vertical" || value.orientation === "horizontal")
    );
  }

  if (value.kind === "spacer") {
    return value.heightUnits === undefined || isLayoutUnit(value.heightUnits);
  }

  return (
    value.kind === "decor" &&
    typeof value.assetId === "string" &&
    value.assetId.length > 0 &&
    isLayoutUnit(value.heightUnits)
  );
}

function uniqueBookIds(bookIds: readonly number[]): number[] {
  return [...new Set(bookIds.filter(isBookId))];
}

function isBookId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLayoutUnit(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0.125 &&
    Math.round(value * 8) === value * 8
  );
}

function initialRowId(shelf: ShelfLayoutShelfName): string {
  return `row:${shelf}:0`;
}

function bookItemId(bookId: number): string {
  return `book:${bookId}`;
}
