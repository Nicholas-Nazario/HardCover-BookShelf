import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { databaseFilenameFromUrl, openDatabase } from "./client";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    if (directory.startsWith(path.join(tmpdir(), "hardcover-shelf-db-"))) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe("SQLite database", () => {
  it("migrates an empty database and configures the connection", () => {
    const directory = temporaryDirectory();
    const filename = path.join(directory, "empty.db");
    const handle = openDatabase(filename);

    const tables = handle.sqlite
      .prepare(
        "select name from sqlite_master where type = 'table' and name in ('profiles', 'books', 'profile_books') order by name",
      )
      .all() as Array<{ name: string }>;

    expect(tables.map(({ name }) => name)).toEqual([
      "books",
      "profile_books",
      "profiles",
    ]);
    expect(handle.sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(handle.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(handle.sqlite.pragma("busy_timeout", { simple: true })).toBe(5000);
    handle.close();

    const reopened = openDatabase(filename);
    expect(
      reopened.sqlite
        .prepare("select count(*) as count from __drizzle_migrations")
        .get(),
    ).toEqual({ count: 2 });
    reopened.close();
  });

  it("migrates an existing initial-schema snapshot with safe metadata defaults", () => {
    const directory = temporaryDirectory();
    const filename = path.join(directory, "existing.db");
    const initialMigrations = path.join(directory, "initial-migrations");
    const initialMeta = path.join(initialMigrations, "meta");
    mkdirSync(initialMeta, { recursive: true });
    copyFileSync(
      path.resolve("drizzle/0000_initial.sql"),
      path.join(initialMigrations, "0000_initial.sql"),
    );
    writeFileSync(
      path.join(initialMeta, "_journal.json"),
      JSON.stringify({
        version: "7",
        dialect: "sqlite",
        entries: [
          {
            idx: 0,
            version: "6",
            when: 1786982400000,
            tag: "0000_initial",
            breakpoints: true,
          },
        ],
      }),
    );

    const initial = openDatabase(filename, {
      migrationsFolder: initialMigrations,
    });
    initial.sqlite.exec(`
      insert into profiles values (42, 'Adam', 'Adam Reader', 1, 1, '2026-08-17T12:00:00.000Z', '2026-08-17T12:00:00.000Z', '2026-08-17T12:00:00.000Z');
      insert into books values (1, 'Existing Book', '["Author"]', '2026-08-17T12:00:00.000Z');
      insert into profile_books values (42, 1, 101, 3);
    `);
    initial.close();

    const migrated = openDatabase(filename);
    expect(
      migrated.sqlite
        .prepare(
          "select title, slug, cover_url, community_rating, ratings_count, series_json from books where hardcover_book_id = 1",
        )
        .get(),
    ).toEqual({
      title: "Existing Book",
      slug: null,
      cover_url: null,
      community_rating: null,
      ratings_count: 0,
      series_json: "[]",
    });
    expect(
      migrated.sqlite
        .prepare(
          "select user_rating, first_read_date, last_read_date from profile_books where hardcover_book_id = 1",
        )
        .get(),
    ).toEqual({
      user_rating: null,
      first_read_date: null,
      last_read_date: null,
    });
    expect(
      migrated.sqlite
        .prepare("select count(*) as count from __drizzle_migrations")
        .get(),
    ).toEqual({ count: 2 });
    migrated.close();
  });

  it("supports development and production file URLs", () => {
    expect(databaseFilenameFromUrl("file:./data/example.db")).toBe(
      path.resolve("./data/example.db"),
    );
    expect(databaseFilenameFromUrl("file:/data/hardcover-shelf.db")).toBe(
      "/data/hardcover-shelf.db",
    );
  });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "hardcover-shelf-db-"));
  temporaryDirectories.push(directory);
  return directory;
}
