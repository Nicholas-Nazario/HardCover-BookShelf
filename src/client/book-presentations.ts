export type BookPresentation = "cover" | "spine";

export type BookPresentationPreferences = Record<number, BookPresentation>;

const STORAGE_PREFIX = "hardcover-shelf:book-presentations:v1:";

export function bookPresentationStorageKey(username: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(username.trim().toLowerCase())}`;
}

export function loadBookPresentationPreferences(
  storage: Pick<Storage, "getItem">,
  username: string,
): BookPresentationPreferences {
  try {
    const stored = storage.getItem(bookPresentationStorageKey(username));

    if (!stored) {
      return {};
    }

    const parsed: unknown = JSON.parse(stored);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const preferences: BookPresentationPreferences = {};

    for (const [rawBookId, presentation] of Object.entries(parsed)) {
      const bookId = Number(rawBookId);

      if (
        Number.isSafeInteger(bookId) &&
        bookId > 0 &&
        (presentation === "cover" || presentation === "spine")
      ) {
        preferences[bookId] = presentation;
      }
    }

    return preferences;
  } catch {
    return {};
  }
}

export function saveBookPresentationPreferences(
  storage: Pick<Storage, "setItem">,
  username: string,
  preferences: BookPresentationPreferences,
): boolean {
  const storedPreferences = Object.fromEntries(
    Object.entries(preferences).filter(
      ([, presentation]) => presentation === "spine",
    ),
  );

  try {
    storage.setItem(
      bookPresentationStorageKey(username),
      JSON.stringify(storedPreferences),
    );
    return true;
  } catch {
    return false;
  }
}
