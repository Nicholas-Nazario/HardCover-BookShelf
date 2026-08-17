import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type DatabaseHandle } from "../../db/client";
import type { HardcoverQueryExecutor } from "../hardcover/client";
import { HardcoverError } from "../hardcover/errors";
import { READ_STATUS, WANT_TO_READ_STATUS } from "../hardcover/library";
import { ProfileRepository } from "./repository";
import { createProfileSynchronizer } from "./sync";

const handles: DatabaseHandle[] = [];
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.close();
  }

  for (const directory of temporaryDirectories.splice(0)) {
    if (directory.startsWith(path.join(tmpdir(), "hardcover-shelf-sync-"))) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe("profile synchronization", () => {
  it("returns shelf counts and writes the validated snapshot", async () => {
    const { repository } = testRepository();
    const executeQuery = successfulExecutor([
      shelfRow(1, READ_STATUS),
      shelfRow(2, READ_STATUS),
      shelfRow(3, WANT_TO_READ_STATUS),
    ]);
    const synchronize = createProfileSynchronizer({
      executeQuery,
      repository,
      now: () => new Date("2026-08-17T12:00:00.000Z"),
    });

    await expect(synchronize(" @Adam ")).resolves.toEqual({
      profile: { username: "Adam", displayName: "Adam Reader" },
      counts: { read: 2, wantToRead: 1 },
      lastSyncedAt: "2026-08-17T12:00:00.000Z",
    });
    expect(repository.getSnapshot("adam").shelves).toMatchObject({
      read: [{ id: 1 }, { id: 2 }],
      wantToRead: [{ id: 3 }],
    });
  });

  it("preserves the old snapshot when any upstream request fails", async () => {
    const { repository } = testRepository();
    let failOnSecondPage = false;
    const executeQuery: HardcoverQueryExecutor = vi.fn(async (request) => {
      if (request.operationName === "PublicProfile") {
        return profileResponse();
      }

      if (failOnSecondPage && request.variables.offset === 2) {
        throw new HardcoverError(
          "HARDCOVER_UNAVAILABLE",
          "Upstream page failed.",
        );
      }

      return {
        user_books: failOnSecondPage
          ? [shelfRow(2, READ_STATUS), shelfRow(3, WANT_TO_READ_STATUS)]
          : [shelfRow(1, READ_STATUS)],
      };
    });
    const timestamps = [
      new Date("2026-08-17T12:00:00.000Z"),
      new Date("2026-08-17T13:00:00.000Z"),
    ];
    const synchronize = createProfileSynchronizer({
      executeQuery,
      repository,
      now: () => timestamps.shift() ?? new Date(0),
      pageSize: 2,
    });

    await synchronize("adam");
    failOnSecondPage = true;
    await expect(synchronize("adam")).rejects.toMatchObject({
      code: "HARDCOVER_UNAVAILABLE",
    });

    expect(repository.getSnapshot("adam")).toMatchObject({
      profile: { lastSyncedAt: "2026-08-17T12:00:00.000Z" },
      shelves: {
        read: [
          {
            id: 1,
            slug: "book-1",
            cover: { url: "https://assets.hardcover.app/covers/1.jpg" },
            communityRating: 4.18,
            userRating: 4.5,
            lastReadDate: "2025-05-12",
          },
        ],
        wantToRead: [],
      },
    });
  });

  it("deduplicates concurrent requests for the same normalized username", async () => {
    let resolveProfile!: (value: unknown) => void;
    const profileRequest = new Promise<unknown>((resolve) => {
      resolveProfile = resolve;
    });
    const executeQuery: HardcoverQueryExecutor = vi.fn((request) => {
      if (request.operationName === "PublicProfile") {
        return profileRequest;
      }

      return Promise.resolve({ user_books: [shelfRow(1, READ_STATUS)] });
    });
    const repository = { replaceSnapshot: vi.fn() };
    const synchronize = createProfileSynchronizer({
      executeQuery,
      repository,
      now: () => new Date("2026-08-17T12:00:00.000Z"),
    });

    const first = synchronize("Adam");
    const second = synchronize("@adam");

    expect(first).toBe(second);
    expect(executeQuery).toHaveBeenCalledTimes(1);
    resolveProfile(profileResponse());
    await Promise.all([first, second]);

    expect(executeQuery).toHaveBeenCalledTimes(2);
    expect(repository.replaceSnapshot).toHaveBeenCalledTimes(1);
  });
});

function successfulExecutor(rows: unknown[]): HardcoverQueryExecutor {
  return vi.fn(async (request) => {
    return request.operationName === "PublicProfile"
      ? profileResponse()
      : { user_books: rows };
  });
}

function profileResponse() {
  return {
    users: [
      {
        id: 42,
        username: "Adam",
        name: "Adam Reader",
        books_count: 3,
        account_privacy_setting_id: 1,
      },
    ],
  };
}

function shelfRow(id: number, statusId: 1 | 3) {
  return {
    id: id + 100,
    status_id: statusId,
    book_id: id,
    privacy_setting_id: 1,
    rating: 4.5,
    first_read_date: "2024-01-02",
    last_read_date: "2025-05-12",
    book: {
      id,
      title: `Book ${id}`,
      slug: `book-${id}`,
      release_year: 2020,
      pages: 320,
      rating: 4.18,
      ratings_count: 100,
      image: {
        url: `https://assets.hardcover.app/covers/${id}.jpg`,
        width: 400,
        height: 600,
      },
      contributions: [{ author: { name: `Author ${id}` } }],
      book_series: [],
    },
  };
}

function testRepository() {
  const directory = mkdtempSync(
    path.join(tmpdir(), "hardcover-shelf-sync-"),
  );
  temporaryDirectories.push(directory);
  const handle = openDatabase(path.join(directory, "test.db"));
  handles.push(handle);
  return { repository: new ProfileRepository(handle.db) };
}
