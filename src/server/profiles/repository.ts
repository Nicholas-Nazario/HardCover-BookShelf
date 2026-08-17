import "server-only";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import type { AppDatabase } from "../../db/client";
import { getDatabase } from "../../db/client";
import { books, profileBooks, profiles } from "../../db/schema";
import type { PublicShelfBook } from "../hardcover/library";
import {
  READ_STATUS,
  WANT_TO_READ_STATUS,
} from "../hardcover/library";
import type { PublicProfile } from "../hardcover/profile";

const SQLITE_INSERT_CHUNK_SIZE = 100;

export interface ShelfBookDto {
  id: number;
  title: string;
  authors: string[];
  slug: string | null;
  cover: {
    url: string;
    width: number | null;
    height: number | null;
  } | null;
  releaseYear: number | null;
  pages: number | null;
  communityRating: number | null;
  ratingsCount: number;
  series: Array<{
    id: number;
    name: string;
    position: number | null;
    featured: boolean;
  }>;
  userRating: number | null;
  firstReadDate: string | null;
  lastReadDate: string | null;
}

export interface ShelfSnapshotDto {
  profile: {
    username: string;
    displayName: string | null;
    lastSyncedAt: string;
  };
  shelves: {
    read: ShelfBookDto[];
    wantToRead: ShelfBookDto[];
  };
}

export interface ReplaceSnapshotInput {
  profile: PublicProfile;
  library: PublicShelfBook[];
  synchronizedAt: string;
}

export class SnapshotNotFoundError extends Error {
  readonly code = "SNAPSHOT_NOT_FOUND";

  constructor() {
    super("No cached shelf snapshot exists for that profile.");
    this.name = "SnapshotNotFoundError";
  }
}

export class ProfileRepository {
  constructor(private readonly db: AppDatabase = getDatabase().db) {}

  replaceSnapshot(input: ReplaceSnapshotInput): void {
    const { profile, library, synchronizedAt } = input;

    this.db.transaction((transaction) => {
      transaction
        .insert(profiles)
        .values({
          hardcoverUserId: profile.id,
          username: profile.username,
          displayName: profile.displayName,
          booksCount: profile.booksCount,
          privacySettingId: 1,
          lastSyncedAt: synchronizedAt,
          createdAt: synchronizedAt,
          updatedAt: synchronizedAt,
        })
        .onConflictDoUpdate({
          target: profiles.hardcoverUserId,
          set: {
            username: profile.username,
            displayName: profile.displayName,
            booksCount: profile.booksCount,
            privacySettingId: 1,
            lastSyncedAt: synchronizedAt,
            updatedAt: synchronizedAt,
          },
        })
        .run();

      for (const chunk of chunks(library, SQLITE_INSERT_CHUNK_SIZE)) {
        transaction
          .insert(books)
          .values(
            chunk.map((book) => ({
              hardcoverBookId: book.id,
              title: book.title,
              authors: book.authors,
              slug: book.slug,
              coverUrl: book.cover?.url ?? null,
              coverWidth: book.cover?.width ?? null,
              coverHeight: book.cover?.height ?? null,
              releaseYear: book.releaseYear,
              pages: book.pages,
              communityRating: book.communityRating,
              ratingsCount: book.ratingsCount,
              series: book.series,
              updatedAt: synchronizedAt,
            })),
          )
          .onConflictDoUpdate({
            target: books.hardcoverBookId,
            set: {
              title: sql.raw("excluded.title"),
              authors: sql.raw("excluded.authors_json"),
              slug: sql.raw("excluded.slug"),
              coverUrl: sql.raw("excluded.cover_url"),
              coverWidth: sql.raw("excluded.cover_width"),
              coverHeight: sql.raw("excluded.cover_height"),
              releaseYear: sql.raw("excluded.release_year"),
              pages: sql.raw("excluded.pages"),
              communityRating: sql.raw("excluded.community_rating"),
              ratingsCount: sql.raw("excluded.ratings_count"),
              series: sql.raw("excluded.series_json"),
              updatedAt: sql.raw("excluded.updated_at"),
            },
          })
          .run();
      }

      transaction
        .delete(profileBooks)
        .where(eq(profileBooks.hardcoverUserId, profile.id))
        .run();

      for (const chunk of chunks(library, SQLITE_INSERT_CHUNK_SIZE)) {
        transaction
          .insert(profileBooks)
          .values(
            chunk.map((book) => ({
              hardcoverUserId: profile.id,
              hardcoverBookId: book.id,
              hardcoverUserBookId: book.hardcoverUserBookId,
              statusId: book.statusId,
              userRating: book.userRating,
              firstReadDate: book.firstReadDate,
              lastReadDate: book.lastReadDate,
            })),
          )
          .run();
      }
    });
  }

  getSnapshot(normalizedUsername: string): ShelfSnapshotDto {
    const profile = this.db
      .select({
        hardcoverUserId: profiles.hardcoverUserId,
        username: profiles.username,
        displayName: profiles.displayName,
        lastSyncedAt: profiles.lastSyncedAt,
      })
      .from(profiles)
      .where(
        and(
          eq(profiles.username, normalizedUsername),
          isNotNull(profiles.lastSyncedAt),
        ),
      )
      .limit(1)
      .get();

    if (!profile?.lastSyncedAt) {
      throw new SnapshotNotFoundError();
    }

    const rows = this.db
      .select({
        id: books.hardcoverBookId,
        title: books.title,
        authors: books.authors,
        slug: books.slug,
        coverUrl: books.coverUrl,
        coverWidth: books.coverWidth,
        coverHeight: books.coverHeight,
        releaseYear: books.releaseYear,
        pages: books.pages,
        communityRating: books.communityRating,
        ratingsCount: books.ratingsCount,
        series: books.series,
        userRating: profileBooks.userRating,
        firstReadDate: profileBooks.firstReadDate,
        lastReadDate: profileBooks.lastReadDate,
        statusId: profileBooks.statusId,
      })
      .from(profileBooks)
      .innerJoin(
        books,
        eq(books.hardcoverBookId, profileBooks.hardcoverBookId),
      )
      .where(eq(profileBooks.hardcoverUserId, profile.hardcoverUserId))
      .orderBy(asc(profileBooks.statusId), asc(books.hardcoverBookId))
      .all();

    const snapshot: ShelfSnapshotDto = {
      profile: {
        username: profile.username,
        displayName: profile.displayName,
        lastSyncedAt: profile.lastSyncedAt,
      },
      shelves: {
        read: [],
        wantToRead: [],
      },
    };

    for (const row of rows) {
      const dto = {
        id: row.id,
        title: row.title,
        authors: row.authors,
        slug: row.slug,
        cover: row.coverUrl
          ? {
              url: row.coverUrl,
              width: row.coverWidth,
              height: row.coverHeight,
            }
          : null,
        releaseYear: row.releaseYear,
        pages: row.pages,
        communityRating: row.communityRating,
        ratingsCount: row.ratingsCount,
        series: row.series,
        userRating: row.userRating,
        firstReadDate: row.firstReadDate,
        lastReadDate: row.lastReadDate,
      };

      if (row.statusId === READ_STATUS) {
        snapshot.shelves.read.push(dto);
      } else if (row.statusId === WANT_TO_READ_STATUS) {
        snapshot.shelves.wantToRead.push(dto);
      }
    }

    return snapshot;
  }
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }

  return result;
}
