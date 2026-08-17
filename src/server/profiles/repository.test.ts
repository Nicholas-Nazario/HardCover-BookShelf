import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type DatabaseHandle } from "../../db/client";
import type { PublicShelfBook } from "../hardcover/library";
import { READ_STATUS, WANT_TO_READ_STATUS } from "../hardcover/library";
import { ProfileRepository } from "./repository";

const handles: DatabaseHandle[] = [];
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.close();
  }

  for (const directory of temporaryDirectories.splice(0)) {
    if (directory.startsWith(path.join(tmpdir(), "hardcover-shelf-repo-"))) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe("ProfileRepository", () => {
  it("transactionally replaces and returns a complete enriched snapshot", () => {
    const { repository } = testRepository();

    repository.replaceSnapshot({
      profile: profile(42, "Adam"),
      library: [book(1, READ_STATUS), book(2, WANT_TO_READ_STATUS)],
      synchronizedAt: "2026-08-17T12:00:00.000Z",
    });
    repository.replaceSnapshot({
      profile: profile(42, "Adam", 1),
      library: [book(3, READ_STATUS)],
      synchronizedAt: "2026-08-17T13:00:00.000Z",
    });

    expect(repository.getSnapshot("adam")).toEqual({
      profile: {
        username: "Adam",
        displayName: "Adam Reader",
        lastSyncedAt: "2026-08-17T13:00:00.000Z",
      },
      shelves: {
        read: [bookDto(book(3, READ_STATUS))],
        wantToRead: [],
      },
    });
  });

  it("stores reader metadata separately for profiles sharing one Hardcover book", () => {
    const { repository, handle } = testRepository();
    const shared = book(1, READ_STATUS);

    repository.replaceSnapshot({
      profile: profile(42, "Adam"),
      library: [{ ...shared, userRating: 4.5, firstReadDate: "2024-01-02" }],
      synchronizedAt: "2026-08-17T12:00:00.000Z",
    });
    repository.replaceSnapshot({
      profile: profile(43, "Eve"),
      library: [
        {
          ...shared,
          hardcoverUserBookId: 201,
          userRating: 2,
          firstReadDate: null,
          lastReadDate: null,
        },
      ],
      synchronizedAt: "2026-08-17T12:01:00.000Z",
    });

    expect(repository.getSnapshot("adam").shelves.read[0]).toMatchObject({
      id: 1,
      communityRating: 4.18,
      userRating: 4.5,
      firstReadDate: "2024-01-02",
    });
    expect(repository.getSnapshot("eve").shelves.read[0]).toMatchObject({
      id: 1,
      communityRating: 4.18,
      userRating: 2,
      firstReadDate: null,
    });
    expect(
      handle.sqlite
        .prepare(
          "select hardcover_user_id, user_rating from profile_books order by hardcover_user_id",
        )
        .all(),
    ).toEqual([
      { hardcover_user_id: 42, user_rating: 4.5 },
      { hardcover_user_id: 43, user_rating: 2 },
    ]);
  });

  it("replaces changed shared metadata and upstream nulls instead of retaining stale values", () => {
    const { repository } = testRepository();
    repository.replaceSnapshot({
      profile: profile(42, "Adam"),
      library: [book(1, READ_STATUS)],
      synchronizedAt: "2026-08-17T12:00:00.000Z",
    });
    repository.replaceSnapshot({
      profile: profile(42, "Adam"),
      library: [
        {
          ...book(1, READ_STATUS),
          title: "Updated title",
          authors: ["Updated Author"],
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
      ],
      synchronizedAt: "2026-08-17T13:00:00.000Z",
    });

    expect(repository.getSnapshot("adam").shelves.read).toEqual([
      {
        id: 1,
        title: "Updated title",
        authors: ["Updated Author"],
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

  it("round-trips every series relationship as JSON", () => {
    const { repository, handle } = testRepository();
    repository.replaceSnapshot({
      profile: profile(42, "Adam"),
      library: [book(1, READ_STATUS)],
      synchronizedAt: "2026-08-17T12:00:00.000Z",
    });

    expect(repository.getSnapshot("adam").shelves.read[0]?.series).toEqual([
      { id: 9, name: "Series 1", position: 1.5, featured: true },
      { id: 10, name: "Other Series", position: null, featured: false },
    ]);
    expect(
      handle.sqlite
        .prepare("select series_json from books where hardcover_book_id = 1")
        .get(),
    ).toEqual({
      series_json:
        '[{"id":9,"name":"Series 1","position":1.5,"featured":true},{"id":10,"name":"Other Series","position":null,"featured":false}]',
    });
  });

  it("rolls back every metadata write when replacement cannot complete", () => {
    const { repository } = testRepository();
    repository.replaceSnapshot({
      profile: profile(42, "Adam"),
      library: [book(1, READ_STATUS)],
      synchronizedAt: "2026-08-17T12:00:00.000Z",
    });

    expect(() =>
      repository.replaceSnapshot({
        profile: profile(42, "Changed Adam"),
        library: [
          {
            ...book(1, READ_STATUS),
            title: "Must roll back",
            cover: null,
            statusId: 2,
          } as unknown as PublicShelfBook,
        ],
        synchronizedAt: "2026-08-17T13:00:00.000Z",
      }),
    ).toThrow();

    expect(repository.getSnapshot("adam")).toMatchObject({
      profile: {
        displayName: "Adam Reader",
        lastSyncedAt: "2026-08-17T12:00:00.000Z",
      },
      shelves: {
        read: [
          {
            id: 1,
            title: "Book 1",
            cover: { url: "https://assets.hardcover.app/covers/1.jpg" },
          },
        ],
        wantToRead: [],
      },
    });
  });

  it("is idempotent when the same snapshot is synchronized twice", () => {
    const { repository, handle } = testRepository();
    const snapshot = {
      profile: profile(42, "Adam"),
      library: [book(1, READ_STATUS), book(2, WANT_TO_READ_STATUS)],
      synchronizedAt: "2026-08-17T12:00:00.000Z",
    };

    repository.replaceSnapshot(snapshot);
    repository.replaceSnapshot(snapshot);

    expect(
      handle.sqlite.prepare("select count(*) as count from profiles").get(),
    ).toEqual({ count: 1 });
    expect(
      handle.sqlite.prepare("select count(*) as count from books").get(),
    ).toEqual({ count: 2 });
    expect(
      handle.sqlite.prepare("select count(*) as count from profile_books").get(),
    ).toEqual({ count: 2 });
  });
});

function testRepository() {
  const directory = mkdtempSync(path.join(tmpdir(), "hardcover-shelf-repo-"));
  temporaryDirectories.push(directory);
  const handle = openDatabase(path.join(directory, "test.db"));
  handles.push(handle);
  return { handle, repository: new ProfileRepository(handle.db) };
}

function profile(id: number, username: string, booksCount = 1) {
  return {
    id,
    username,
    displayName: `${username} Reader`,
    booksCount,
  };
}

function book(id: number, statusId: 1 | 3): PublicShelfBook {
  return {
    id,
    hardcoverUserBookId: id + 10_000,
    title: `Book ${id}`,
    authors: [`Author ${id}`],
    statusId,
    slug: `book-${id}`,
    cover: {
      url: `https://assets.hardcover.app/covers/${id}.jpg`,
      width: 400,
      height: 600,
    },
    releaseYear: 2000 + id,
    pages: 300 + id,
    communityRating: 4.18,
    ratingsCount: 2_431,
    series: [
      { id: 9, name: `Series ${id}`, position: 1.5, featured: true },
      { id: 10, name: "Other Series", position: null, featured: false },
    ],
    userRating: 4.5,
    firstReadDate: "2024-01-02",
    lastReadDate: "2025-05-12",
  };
}

function bookDto(value: PublicShelfBook) {
  const { hardcoverUserBookId: _hardcoverUserBookId, statusId: _statusId, ...dto } =
    value;
  return dto;
}
