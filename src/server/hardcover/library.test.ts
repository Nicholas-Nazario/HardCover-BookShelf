import { describe, expect, it, vi } from "vitest";
import type { HardcoverQueryExecutor } from "./client";
import {
  cleanAuthorNames,
  fetchPublicLibrary,
  formatAuthorsForDisplay,
  READ_STATUS,
  UNKNOWN_AUTHOR,
  WANT_TO_READ_STATUS,
} from "./library";

function shelfRow(
  id: number,
  options: {
    statusId?: number;
    privacySettingId?: number;
    title?: string;
    authors?: Array<string | null>;
    book?: Record<string, unknown>;
    user?: Record<string, unknown>;
  } = {},
) {
  return {
    id: id + 10_000,
    status_id: options.statusId ?? READ_STATUS,
    book_id: id,
    privacy_setting_id: options.privacySettingId ?? 1,
    rating: null,
    first_read_date: null,
    last_read_date: null,
    ...options.user,
    book: {
      id,
      title: options.title ?? `Book ${id}`,
      slug: null,
      release_year: null,
      pages: null,
      rating: null,
      ratings_count: 0,
      image: null,
      contributions: (options.authors ?? [`Author ${id}`]).map((name) => ({
        author: name === null ? null : { name },
      })),
      book_series: [],
      ...options.book,
    },
  };
}

describe("fetchPublicLibrary", () => {
  it("paginates until a short page and starts with 50 records per page", async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) =>
      shelfRow(index + 1),
    );
    const executeQuery: HardcoverQueryExecutor = vi
      .fn()
      .mockResolvedValueOnce({ user_books: firstPage })
      .mockResolvedValueOnce({ user_books: [shelfRow(51)] });

    const books = await fetchPublicLibrary(42, executeQuery);

    expect(books).toHaveLength(51);
    expect(executeQuery).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        operationName: "PublicShelfBooks",
        variables: { userId: 42, limit: 50, offset: 0 },
      }),
    );
    expect(executeQuery).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        variables: { userId: 42, limit: 50, offset: 50 },
      }),
    );
  });

  it("queries all approved metadata without editions or ISBNs", async () => {
    const executeQuery: HardcoverQueryExecutor = vi.fn().mockResolvedValue({
      user_books: [],
    });

    await fetchPublicLibrary(42, executeQuery);

    const query = String(
      (executeQuery as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].query,
    );
    expect(query).toMatch(/\brating\b/);
    expect(query).toMatch(/first_read_date/);
    expect(query).toMatch(/last_read_date/);
    expect(query).toMatch(/\bslug\b/);
    expect(query).toMatch(/release_year/);
    expect(query).toMatch(/\bpages\b/);
    expect(query).toMatch(/ratings_count/);
    expect(query).toMatch(/image\s*\{[\s\S]*url[\s\S]*width[\s\S]*height/);
    expect(query).toMatch(/book_series\s*\{[\s\S]*featured[\s\S]*position/);
    expect(query).not.toMatch(/\bedition(?:s)?\b/i);
    expect(query).not.toMatch(/\bisbn(?:_10|_13)?\b/i);
  });

  it("maps complete shared and reader metadata and normalizes numeric strings", async () => {
    const executeQuery: HardcoverQueryExecutor = vi.fn().mockResolvedValue({
      user_books: [
        shelfRow(1, {
          book: {
            slug: " leviathan-wakes ",
            release_year: "2011",
            pages: "561",
            rating: "4.18",
            ratings_count: "2431",
            image: {
              url: "https://assets.hardcover.app/covers/123.jpg?v=2",
              width: "400",
              height: 600,
            },
            book_series: [
              {
                featured: true,
                position: "1.5",
                series: { id: 9, name: " The Expanse " },
              },
            ],
          },
          user: {
            rating: "4.5",
            first_read_date: "2024-01-02",
            last_read_date: "2025-05-12",
          },
        }),
      ],
    });

    await expect(fetchPublicLibrary(42, executeQuery)).resolves.toEqual([
      {
        id: 1,
        hardcoverUserBookId: 10_001,
        title: "Book 1",
        authors: ["Author 1"],
        statusId: READ_STATUS,
        slug: "leviathan-wakes",
        cover: {
          url: "https://assets.hardcover.app/covers/123.jpg?v=2",
          width: 400,
          height: 600,
        },
        releaseYear: 2011,
        pages: 561,
        communityRating: 4.18,
        ratingsCount: 2431,
        series: [
          {
            id: 9,
            name: "The Expanse",
            position: 1.5,
            featured: true,
          },
        ],
        userRating: 4.5,
        firstReadDate: "2024-01-02",
        lastReadDate: "2025-05-12",
      },
    ]);
  });

  it("keeps community and shelf-owner ratings distinct", async () => {
    const executeQuery: HardcoverQueryExecutor = vi.fn().mockResolvedValue({
      user_books: [
        shelfRow(1, {
          book: { rating: 4.2 },
          user: { rating: 2.5 },
        }),
      ],
    });

    const [book] = await fetchPublicLibrary(42, executeQuery);
    expect(book).toMatchObject({ communityRating: 4.2, userRating: 2.5 });
  });

  it("normalizes missing or malformed optional metadata without dropping the book", async () => {
    const executeQuery: HardcoverQueryExecutor = vi.fn().mockResolvedValue({
      user_books: [
        shelfRow(1, {
          book: {
            slug: " ",
            release_year: 1.2,
            pages: 0,
            rating: 6,
            ratings_count: -1,
            image: { url: null, width: 0, height: -1 },
            book_series: null,
          },
          user: {
            rating: "not-a-number",
            first_read_date: "2025-02-30",
            last_read_date: "08/17/2026",
          },
        }),
      ],
    });

    await expect(fetchPublicLibrary(42, executeQuery)).resolves.toMatchObject([
      {
        slug: null,
        cover: null,
        releaseYear: null,
        pages: null,
        communityRating: null,
        ratingsCount: 0,
        series: [],
        userRating: null,
        firstReadDate: null,
        lastReadDate: null,
      },
    ]);
  });

  it.each([
    "http://assets.hardcover.app/cover.jpg",
    "https://images.hardcover.app/cover.jpg",
    "https://assets.hardcover.app:444/cover.jpg",
    "https://user:pass@assets.hardcover.app/cover.jpg",
    "not a URL",
  ])("rejects the disallowed cover URL %s without failing the page", async (url) => {
    const executeQuery: HardcoverQueryExecutor = vi.fn().mockResolvedValue({
      user_books: [shelfRow(1, { book: { image: { url, width: 10, height: 20 } } })],
    });

    const [book] = await fetchPublicLibrary(42, executeQuery);
    expect(book?.cover).toBeNull();
  });

  it("keeps an allowed cover while nulling invalid dimensions independently", async () => {
    const executeQuery: HardcoverQueryExecutor = vi.fn().mockResolvedValue({
      user_books: [
        shelfRow(1, {
          book: {
            image: {
              url: "https://assets.hardcover.app/cover.jpg",
              width: -4,
              height: "unknown",
            },
          },
        }),
      ],
    });

    const [book] = await fetchPublicLibrary(42, executeQuery);
    expect(book?.cover).toEqual({
      url: "https://assets.hardcover.app/cover.jpg",
      width: null,
      height: null,
    });
  });

  it("normalizes, deduplicates, and deterministically orders multiple series", async () => {
    const executeQuery: HardcoverQueryExecutor = vi.fn().mockResolvedValue({
      user_books: [
        shelfRow(1, {
          book: {
            book_series: [
              { featured: false, position: 2, series: { id: 3, name: "Zulu" } },
              { featured: false, position: 1, series: { id: 2, name: "Alpha" } },
              { featured: true, position: "3.5", series: { id: 3, name: "Zulu" } },
              { featured: false, position: 4, series: { id: -1, name: "Bad" } },
              { featured: false, position: 5, series: { id: 5, name: " " } },
              { featured: false, position: 6, series: null },
            ],
          },
        }),
      ],
    });

    const [book] = await fetchPublicLibrary(42, executeQuery);
    expect(book?.series).toEqual([
      { id: 3, name: "Zulu", position: 3.5, featured: true },
      { id: 2, name: "Alpha", position: 1, featured: false },
    ]);
  });

  it("keeps only public Read and Want to Read entries and the first duplicate book", async () => {
    const executeQuery: HardcoverQueryExecutor = vi.fn().mockResolvedValue({
      user_books: [
        shelfRow(1, { statusId: WANT_TO_READ_STATUS }),
        shelfRow(1, { title: "Duplicate" }),
        shelfRow(2, { statusId: READ_STATUS }),
        shelfRow(3, { statusId: 2 }),
        shelfRow(4, { privacySettingId: 2 }),
      ],
    });

    await expect(fetchPublicLibrary(42, executeQuery)).resolves.toMatchObject([
      { id: 1, title: "Book 1", statusId: WANT_TO_READ_STATUS },
      { id: 2, statusId: READ_STATUS },
    ]);
  });

  it("preserves multiple authors while removing blanks and duplicates", async () => {
    const executeQuery: HardcoverQueryExecutor = vi.fn().mockResolvedValue({
      user_books: [
        shelfRow(1, {
          authors: [" First Author ", "", null, "Second Author", "First Author"],
        }),
      ],
    });

    const [book] = await fetchPublicLibrary(42, executeQuery);

    expect(book?.authors).toEqual(["First Author", "Second Author"]);
    expect(formatAuthorsForDisplay(book?.authors ?? [])).toBe(
      "First Author, Second Author",
    );
  });

  it("keeps missing authors as an empty array with a display fallback", async () => {
    const executeQuery: HardcoverQueryExecutor = vi.fn().mockResolvedValue({
      user_books: [shelfRow(1, { authors: [null, "  "] })],
    });

    const [book] = await fetchPublicLibrary(42, executeQuery);

    expect(book?.authors).toEqual([]);
    expect(formatAuthorsForDisplay(book?.authors ?? [])).toBe(UNKNOWN_AUTHOR);
  });

  it("rejects malformed core books instead of returning a partial snapshot", async () => {
    const executeQuery: HardcoverQueryExecutor = vi.fn().mockResolvedValue({
      user_books: [shelfRow(1), { ...shelfRow(2), book: null }],
    });

    await expect(fetchPublicLibrary(42, executeQuery)).rejects.toMatchObject({
      code: "HARDCOVER_INVALID_RESPONSE",
    });
  });
});

describe("cleanAuthorNames", () => {
  it("retains first-seen API order", () => {
    expect(cleanAuthorNames(["A", "B", "A", "C"])).toEqual(["A", "B", "C"]);
  });
});
