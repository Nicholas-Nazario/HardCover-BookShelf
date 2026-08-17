import "server-only";
import { z } from "zod";
import {
  isAllowedHardcoverCoverUrl,
  isIsoDate,
} from "../../shared/book-metadata";
import {
  executeHardcoverQuery,
  type HardcoverQueryExecutor,
} from "./client";
import { HardcoverError } from "./errors";

export const WANT_TO_READ_STATUS = 1;
export const READ_STATUS = 3;
export const PUBLIC_ENTRY_PRIVACY_SETTING = 1;
export const LIBRARY_PAGE_SIZE = 50;
export const UNKNOWN_AUTHOR = "Unknown author";

const shelfPageSchema = z.object({
  user_books: z.array(
    z.object({
      id: z.number().int().positive(),
      status_id: z.number().int(),
      book_id: z.number().int().positive(),
      privacy_setting_id: z.number().int(),
      rating: z.unknown().optional(),
      first_read_date: z.unknown().optional(),
      last_read_date: z.unknown().optional(),
      book: z.object({
        id: z.number().int().positive(),
        title: z.string(),
        slug: z.unknown().optional(),
        release_year: z.unknown().optional(),
        pages: z.unknown().optional(),
        rating: z.unknown().optional(),
        ratings_count: z.unknown().optional(),
        image: z.unknown().optional(),
        contributions: z.array(
          z.object({
            author: z
              .object({
                name: z.string().nullable(),
              })
              .nullable(),
          }),
        ),
        book_series: z.unknown().optional(),
      }),
    }),
  ),
});

const PUBLIC_SHELF_BOOKS_QUERY = `
  query PublicShelfBooks($userId: Int!, $limit: Int!, $offset: Int!) {
    user_books(
      where: {
        user_id: { _eq: $userId }
        status_id: { _in: [1, 3] }
        privacy_setting_id: { _eq: 1 }
      }
      distinct_on: book_id
      order_by: [{ book_id: asc }]
      limit: $limit
      offset: $offset
    ) {
      id
      status_id
      book_id
      privacy_setting_id
      rating
      first_read_date
      last_read_date
      book {
        id
        title
        slug
        release_year
        pages
        rating
        ratings_count
        image {
          url
          width
          height
        }
        contributions {
          author {
            name
          }
        }
        book_series {
          featured
          position
          series {
            id
            name
          }
        }
      }
    }
  }
`;

export type ShelfStatus =
  | typeof WANT_TO_READ_STATUS
  | typeof READ_STATUS;

export interface PublicShelfBook {
  id: number;
  hardcoverUserBookId: number;
  title: string;
  authors: string[];
  statusId: ShelfStatus;
  slug: string | null;
  cover: BookCover | null;
  releaseYear: number | null;
  pages: number | null;
  communityRating: number | null;
  ratingsCount: number;
  series: BookSeries[];
  userRating: number | null;
  firstReadDate: string | null;
  lastReadDate: string | null;
}

export interface BookCover {
  url: string;
  width: number | null;
  height: number | null;
}

export interface BookSeries {
  id: number;
  name: string;
  position: number | null;
  featured: boolean;
}

export async function fetchPublicLibrary(
  hardcoverUserId: number,
  executeQuery: HardcoverQueryExecutor = executeHardcoverQuery,
  pageSize = LIBRARY_PAGE_SIZE,
): Promise<PublicShelfBook[]> {
  if (!Number.isSafeInteger(hardcoverUserId) || hardcoverUserId <= 0) {
    throw invalidLibraryResponse();
  }

  if (!Number.isSafeInteger(pageSize) || pageSize <= 0) {
    throw new RangeError("Library page size must be a positive integer.");
  }

  const booksById = new Map<number, PublicShelfBook>();
  let offset = 0;

  while (true) {
    const rawData = await executeQuery({
      operationName: "PublicShelfBooks",
      query: PUBLIC_SHELF_BOOKS_QUERY,
      variables: {
        userId: hardcoverUserId,
        limit: pageSize,
        offset,
      },
    });
    const parsedPage = shelfPageSchema.safeParse(rawData);

    if (!parsedPage.success) {
      throw invalidLibraryResponse();
    }

    for (const row of parsedPage.data.user_books) {
      if (
        row.privacy_setting_id !== PUBLIC_ENTRY_PRIVACY_SETTING ||
        !isShelfStatus(row.status_id)
      ) {
        continue;
      }

      if (row.book.id !== row.book_id) {
        throw invalidLibraryResponse();
      }

      const title = row.book.title.trim();

      if (!title) {
        throw invalidLibraryResponse();
      }

      if (!booksById.has(row.book_id)) {
        booksById.set(row.book_id, {
          id: row.book_id,
          hardcoverUserBookId: row.id,
          title,
          authors: cleanAuthorNames(
            row.book.contributions.map(
              (contribution) => contribution.author?.name,
            ),
          ),
          statusId: row.status_id,
          slug: normalizeNonEmptyString(row.book.slug),
          cover: normalizeCover(row.book.image),
          releaseYear: normalizeSafeInteger(row.book.release_year),
          pages: normalizePositiveSafeInteger(row.book.pages),
          communityRating: normalizeRating(row.book.rating),
          ratingsCount:
            normalizeNonNegativeSafeInteger(row.book.ratings_count) ?? 0,
          series: normalizeSeries(row.book.book_series),
          userRating: normalizeRating(row.rating),
          firstReadDate: normalizeReadDate(row.first_read_date),
          lastReadDate: normalizeReadDate(row.last_read_date),
        });
      }
    }

    if (parsedPage.data.user_books.length < pageSize) {
      break;
    }

    offset += pageSize;
  }

  return [...booksById.values()];
}

export function cleanAuthorNames(
  names: ReadonlyArray<string | null | undefined>,
): string[] {
  const uniqueNames = new Set<string>();

  for (const name of names) {
    const normalizedName = name?.trim();

    if (normalizedName) {
      uniqueNames.add(normalizedName);
    }
  }

  return [...uniqueNames];
}

export function formatAuthorsForDisplay(authors: readonly string[]): string {
  return authors.length > 0 ? authors.join(", ") : UNKNOWN_AUTHOR;
}

function normalizeCover(value: unknown): BookCover | null {
  if (!isRecord(value) || !isAllowedHardcoverCoverUrl(value.url)) {
    return null;
  }

  return {
    url: value.url,
    width: normalizePositiveSafeInteger(value.width),
    height: normalizePositiveSafeInteger(value.height),
  };
}

function normalizeSeries(value: unknown): BookSeries[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seriesById = new Map<number, BookSeries>();

  for (const relationship of value) {
    if (!isRecord(relationship) || !isRecord(relationship.series)) {
      continue;
    }

    const id = normalizePositiveSafeInteger(relationship.series.id);
    const name = normalizeNonEmptyString(relationship.series.name);

    if (id === null || name === null) {
      continue;
    }

    const normalized = {
      id,
      name,
      position: normalizeFiniteNumber(relationship.position),
      featured: relationship.featured === true,
    };
    const existing = seriesById.get(id);

    if (!existing || (!existing.featured && normalized.featured)) {
      seriesById.set(id, normalized);
    }
  }

  return [...seriesById.values()].sort((left, right) => {
    if (left.featured !== right.featured) {
      return left.featured ? -1 : 1;
    }

    const nameComparison =
      left.name === right.name ? 0 : left.name < right.name ? -1 : 1;
    return nameComparison || left.id - right.id;
  });
}

function normalizeReadDate(value: unknown): string | null {
  return isIsoDate(value) ? value : null;
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

function normalizeRating(value: unknown): number | null {
  const rating = normalizeFiniteNumber(value);
  return rating !== null && rating >= 0 && rating <= 5 ? rating : null;
}

function normalizeSafeInteger(value: unknown): number | null {
  const number = normalizeFiniteNumber(value);
  return number !== null && Number.isSafeInteger(number) ? number : null;
}

function normalizePositiveSafeInteger(value: unknown): number | null {
  const number = normalizeSafeInteger(value);
  return number !== null && number > 0 ? number : null;
}

function normalizeNonNegativeSafeInteger(value: unknown): number | null {
  const number = normalizeSafeInteger(value);
  return number !== null && number >= 0 ? number : null;
}

function normalizeFiniteNumber(value: unknown): number | null {
  if (
    typeof value !== "number" &&
    (typeof value !== "string" || value.trim() === "")
  ) {
    return null;
  }

  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isShelfStatus(statusId: number): statusId is ShelfStatus {
  return statusId === WANT_TO_READ_STATUS || statusId === READ_STATUS;
}

function invalidLibraryResponse(): HardcoverError {
  return new HardcoverError(
    "HARDCOVER_INVALID_RESPONSE",
    "Hardcover returned an unexpected library response.",
  );
}
