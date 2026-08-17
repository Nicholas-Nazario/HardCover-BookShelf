import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDatabase, openDatabase } from "../../db/client";
import { READ_STATUS, WANT_TO_READ_STATUS } from "../hardcover/library";
import { ProfileRepository } from "./repository";

const directory = mkdtempSync(path.join(tmpdir(), "hardcover-shelf-route-"));
const filename = path.join(directory, "test.db");

beforeAll(() => {
  process.env.DATABASE_URL = `file:${filename}`;
  const handle = openDatabase(filename);
  const repository = new ProfileRepository(handle.db);
  repository.replaceSnapshot({
    profile: {
      id: 42,
      username: "Adam",
      displayName: "Adam Reader",
      booksCount: 2,
    },
    library: [
      {
        id: 1,
        hardcoverUserBookId: 101,
        title: "Read Book",
        authors: ["First Author", "Second Author"],
        statusId: READ_STATUS,
        slug: "read-book",
        cover: {
          url: "https://assets.hardcover.app/covers/read.jpg",
          width: 400,
          height: 600,
        },
        releaseYear: 2020,
        pages: 320,
        communityRating: 4.25,
        ratingsCount: 100,
        series: [
          {
            id: 9,
            name: "Example Series",
            position: 1,
            featured: true,
          },
        ],
        userRating: 5,
        firstReadDate: "2025-01-02",
        lastReadDate: "2025-01-02",
      },
      {
        id: 2,
        hardcoverUserBookId: 102,
        title: "Wanted Book",
        authors: [],
        statusId: WANT_TO_READ_STATUS,
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
    synchronizedAt: "2026-08-17T12:00:00.000Z",
  });
  handle.close();
});

afterAll(() => {
  getDatabase().close();
  delete process.env.DATABASE_URL;

  if (directory.startsWith(path.join(tmpdir(), "hardcover-shelf-route-"))) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("GET /api/profiles/{username}/books", () => {
  it("returns only the application Read and Want to Read DTO", async () => {
    const { GET } = await import(
      "../../app/api/profiles/[username]/books/route"
    );
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ username: "@Adam" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      profile: {
        username: "Adam",
        displayName: "Adam Reader",
        lastSyncedAt: "2026-08-17T12:00:00.000Z",
      },
      shelves: {
        read: [
          {
            id: 1,
            title: "Read Book",
            authors: ["First Author", "Second Author"],
            slug: "read-book",
            cover: {
              url: "https://assets.hardcover.app/covers/read.jpg",
              width: 400,
              height: 600,
            },
            releaseYear: 2020,
            pages: 320,
            communityRating: 4.25,
            ratingsCount: 100,
            series: [
              {
                id: 9,
                name: "Example Series",
                position: 1,
                featured: true,
              },
            ],
            userRating: 5,
            firstReadDate: "2025-01-02",
            lastReadDate: "2025-01-02",
          },
        ],
        wantToRead: [
          {
            id: 2,
            title: "Wanted Book",
            authors: [],
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
      },
    });
  });

  it("returns 404 when no cached snapshot exists", async () => {
    const { GET } = await import(
      "../../app/api/profiles/[username]/books/route"
    );
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ username: "missing" }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        code: "SNAPSHOT_NOT_FOUND",
        message: "No cached shelf snapshot exists for that profile.",
      },
    });
  });
});
