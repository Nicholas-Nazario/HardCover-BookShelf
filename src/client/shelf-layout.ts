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
  stacks: Record<string, HorizontalBookStack>;
}

export interface HorizontalBookStack {
  id: string;
  rowId: string;
  bookItemIds: string[];
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

export function updateBookOrientation(
  layout: ShelfLayout,
  bookId: number,
  orientation: BookOrientation,
): ShelfLayout {
  const itemId = bookItemId(bookId);
  let changed = false;
  const shelves = {} as ShelfLayout["shelves"];
  for (const shelf of ["read", "wantToRead"] as const) {
    const scene = layout.shelves[shelf];
    const item = scene.items[itemId];
    const isStackMember = Object.values(scene.stacks).some((stack) =>
      stack.bookItemIds.includes(itemId),
    );
    if (
      !item ||
      item.kind !== "book" ||
      item.orientation === orientation ||
      (isStackMember && orientation !== "horizontal")
    ) {
      shelves[shelf] = scene;
      continue;
    }
    changed = true;
    shelves[shelf] = {
      ...scene,
      items: { ...scene.items, [itemId]: { ...item, orientation } },
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
  const stack = stackForPlacementId(scene, activeItemId);
  if (!sourceRow || !targetRow || (!item && !stack)) return layout;
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
        items: stack
          ? Object.fromEntries(
              Object.entries(scene.items).map(([itemId, currentItem]) => [
                itemId,
                stack.bookItemIds.includes(itemId)
                  ? { ...currentItem, rowId: targetRow.id }
                  : currentItem,
              ]),
            )
          : {
              ...scene.items,
              [activeItemId]: { ...item!, rowId: targetRow.id },
            },
        stacks: stack
          ? {
              ...scene.stacks,
              [stack.id]: { ...stack, rowId: targetRow.id },
            }
          : scene.stacks,
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
    stacks: {},
  };
}

function reconcileScene(
  scene: ShelfSceneLayout,
  shelf: ShelfLayoutShelfName,
  rawBookIds: readonly number[],
): ShelfSceneLayout {
  const expectedBookIds = new Set(uniqueBookIds(rawBookIds));
  const items: Record<string, ShelfItem> = {};

  for (const [itemId, item] of Object.entries(scene.items)) {
    if (item.kind !== "book" || expectedBookIds.has(item.bookId)) {
      items[itemId] = { ...item };
    }
  }

  const stacks: Record<string, HorizontalBookStack> = {};
  const stackMembers = new Set<string>();
  const dissolvingMembers = new Map<string, string>();

  for (const stack of Object.values(scene.stacks)) {
    const bookItemIds = stack.bookItemIds.filter((itemId) => {
      const item = items[itemId];
      return item?.kind === "book";
    });
    const placementId = stackPlacementId(stack.id);

    if (bookItemIds.length >= 2) {
      stacks[stack.id] = { ...stack, bookItemIds };
      bookItemIds.forEach((itemId) => stackMembers.add(itemId));
    } else if (bookItemIds.length === 1) {
      dissolvingMembers.set(placementId, bookItemIds[0]!);
    }
  }

  const rows = scene.rows.map((row) => ({
    ...row,
    items: row.items.flatMap((placementId) => {
      const dissolvedMember = dissolvingMembers.get(placementId);
      if (dissolvedMember) {
        items[dissolvedMember] = { ...items[dissolvedMember]!, rowId: row.id };
        return [dissolvedMember];
      }

      const stack = stackForPlacementId({ ...scene, stacks }, placementId);
      if (stack) {
        stack.rowId = row.id;
        for (const memberId of stack.bookItemIds) {
          items[memberId] = { ...items[memberId]!, rowId: row.id };
        }
        return [placementId];
      }

      return items[placementId] && !stackMembers.has(placementId)
        ? [placementId]
        : [];
    }),
  }));

  const knownBookIds = new Set(
    Object.values(items)
      .filter((item): item is BookShelfItem => item.kind === "book")
      .map((item) => item.bookId),
  );

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

  return { rows, items, stacks };
}

export function createHorizontalBookStack(
  layout: ShelfLayout,
  shelf: ShelfLayoutShelfName,
  bookItemIds: readonly string[],
): ShelfLayout {
  const scene = layout.shelves[shelf];
  const requestedIds = new Set(bookItemIds);
  const orderedIds = scene.rows.flatMap((row) =>
    row.items.filter((itemId) => requestedIds.has(itemId)),
  );

  if (
    orderedIds.length < 2 ||
    orderedIds.length !== requestedIds.size ||
    orderedIds.some((itemId) => scene.items[itemId]?.kind !== "book")
  ) {
    return layout;
  }

  const firstPlacement = scene.rows
    .map((row, rowIndex) => ({
      row,
      rowIndex,
      itemIndex: row.items.findIndex((itemId) => requestedIds.has(itemId)),
    }))
    .find(({ itemIndex }) => itemIndex >= 0);

  if (!firstPlacement) return layout;

  const id = nextStackId(scene.stacks);
  const placementId = stackPlacementId(id);
  const rows = scene.rows.map((row, rowIndex) => {
    const items = row.items.filter((itemId) => !requestedIds.has(itemId));
    if (rowIndex === firstPlacement.rowIndex) {
      items.splice(firstPlacement.itemIndex, 0, placementId);
    }
    return { ...row, items };
  });
  const memberItems = Object.fromEntries(
    orderedIds.map((itemId) => [
      itemId,
      {
        ...scene.items[itemId]!,
        rowId: firstPlacement.row.id,
        orientation: "horizontal" as const,
      },
    ]),
  );

  return {
    ...layout,
    shelves: {
      ...layout.shelves,
      [shelf]: {
        ...scene,
        rows,
        items: { ...scene.items, ...memberItems },
        stacks: {
          ...scene.stacks,
          [id]: {
            id,
            rowId: firstPlacement.row.id,
            bookItemIds: orderedIds,
          },
        },
      },
    },
  };
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
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.shelves)) {
      return null;
    }
    const normalized = {
      ...parsed,
      shelves: {
        read: normalizeStoredScene(parsed.shelves.read),
        wantToRead: normalizeStoredScene(parsed.shelves.wantToRead),
      },
    };
    return isShelfLayout(normalized) ? normalized : null;
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
  if (
    !isRecord(value) ||
    !Array.isArray(value.rows) ||
    !isRecord(value.items) ||
    !isRecord(value.stacks)
  ) {
    return false;
  }

  const rowIds = new Set<string>();
  const placementIds = new Set<string>();
  const placementRows = new Map<string, string>();

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
    if (!Array.isArray(rowItems) || !isStringIdList(rowItems, placementIds)) {
      return false;
    }

    rowIds.add(row.id);
    for (const itemId of rowItems) {
      placementIds.add(itemId);
      placementRows.set(itemId, row.id);
    }
  }

  const stackMemberIds = new Set<string>();
  const stackMemberRows = new Map<string, string>();
  for (const [stackId, stack] of Object.entries(value.stacks)) {
    if (!isHorizontalBookStack(stack, stackId, rowIds)) return false;

    const placementId = stackPlacementId(stackId);
    if (
      !placementIds.has(placementId) ||
      placementRows.get(placementId) !== stack.rowId
    ) {
      return false;
    }

    for (const memberId of stack.bookItemIds) {
      if (!value.items[memberId] || stackMemberIds.has(memberId)) return false;
      stackMemberIds.add(memberId);
      stackMemberRows.set(memberId, stack.rowId);
    }
  }

  for (const placementId of placementIds) {
    if (placementId.startsWith("stack:")) {
      if (!value.stacks[placementId.slice("stack:".length)]) return false;
    } else if (!value.items[placementId]) {
      return false;
    }
  }

  return Object.entries(value.items).every(([itemId, item]) => {
    if (!isShelfItem(item, itemId, rowIds)) return false;

    if (stackMemberIds.has(itemId)) {
      return (
        item.kind === "book" &&
        item.orientation === "horizontal" &&
        !placementIds.has(itemId) &&
        item.rowId === stackMemberRows.get(itemId)
      );
    }

    return placementIds.has(itemId) && item.rowId === placementRows.get(itemId);
  });
}

function isHorizontalBookStack(
  value: unknown,
  stackId: string,
  rowIds: ReadonlySet<string>,
): value is HorizontalBookStack {
  return (
    isRecord(value) &&
    value.id === stackId &&
    stackId.length > 0 &&
    !stackId.includes(":") &&
    typeof value.rowId === "string" &&
    rowIds.has(value.rowId) &&
    Array.isArray(value.bookItemIds) &&
    value.bookItemIds.length >= 2 &&
    isStringIdList(value.bookItemIds, new Set())
  );
}

function normalizeStoredScene(value: unknown): unknown {
  return isRecord(value) ? { ...value, stacks: value.stacks ?? {} } : value;
}

function stackPlacementId(stackId: string): string {
  return `stack:${stackId}`;
}

function stackForPlacementId(
  scene: Pick<ShelfSceneLayout, "stacks">,
  placementId: string,
): HorizontalBookStack | undefined {
  return placementId.startsWith("stack:")
    ? scene.stacks[placementId.slice("stack:".length)]
    : undefined;
}

function nextStackId(stacks: Record<string, HorizontalBookStack>): string {
  let candidate = 1;
  while (stacks[String(candidate)]) candidate += 1;
  return String(candidate);
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
