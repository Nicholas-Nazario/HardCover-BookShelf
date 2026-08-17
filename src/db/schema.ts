import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const profiles = sqliteTable(
  "profiles",
  {
    hardcoverUserId: integer("hardcover_user_id").primaryKey(),
    username: text("username").notNull(),
    displayName: text("display_name"),
    booksCount: integer("books_count").notNull(),
    privacySettingId: integer("privacy_setting_id").notNull(),
    lastSyncedAt: text("last_synced_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("profiles_username_unique").on(table.username),
    check(
      "profiles_privacy_setting_check",
      sql`${table.privacySettingId} = 1`,
    ),
  ],
);

export const books = sqliteTable("books", {
  hardcoverBookId: integer("hardcover_book_id").primaryKey(),
  title: text("title").notNull(),
  authors: text("authors_json", { mode: "json" })
    .$type<string[]>()
    .notNull(),
  slug: text("slug"),
  coverUrl: text("cover_url"),
  coverWidth: integer("cover_width"),
  coverHeight: integer("cover_height"),
  releaseYear: integer("release_year"),
  pages: integer("pages"),
  communityRating: real("community_rating"),
  ratingsCount: integer("ratings_count").notNull().default(0),
  series: text("series_json", { mode: "json" })
    .$type<
      Array<{
        id: number;
        name: string;
        position: number | null;
        featured: boolean;
      }>
    >()
    .notNull()
    .default([]),
  updatedAt: text("updated_at").notNull(),
});

export const profileBooks = sqliteTable(
  "profile_books",
  {
    hardcoverUserId: integer("hardcover_user_id")
      .notNull()
      .references(() => profiles.hardcoverUserId, { onDelete: "cascade" }),
    hardcoverBookId: integer("hardcover_book_id")
      .notNull()
      .references(() => books.hardcoverBookId, { onDelete: "cascade" }),
    hardcoverUserBookId: integer("hardcover_user_book_id").notNull(),
    statusId: integer("status_id").notNull(),
    userRating: real("user_rating"),
    firstReadDate: text("first_read_date"),
    lastReadDate: text("last_read_date"),
  },
  (table) => [
    primaryKey({ columns: [table.hardcoverUserId, table.hardcoverBookId] }),
    index("profile_books_profile_status_idx").on(
      table.hardcoverUserId,
      table.statusId,
    ),
    check(
      "profile_books_status_check",
      sql`${table.statusId} in (1, 3)`,
    ),
  ],
);
