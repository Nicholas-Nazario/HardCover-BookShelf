import { describe, expect, it, vi } from "vitest";
import type { HardcoverQueryExecutor } from "./client";
import { ProfileNotFoundError, ProfileNotPublicError } from "./errors";
import { validatePublicProfile } from "./profile";

describe("validatePublicProfile", () => {
  it("returns an application-owned DTO for a public profile", async () => {
    const executeQuery: HardcoverQueryExecutor = vi.fn().mockResolvedValue({
      users: [
        {
          id: 42,
          username: "Adam",
          name: "Adam",
          books_count: 321,
          account_privacy_setting_id: 1,
          email: "must-not-leak@example.com",
        },
      ],
    });

    await expect(validatePublicProfile("@Adam", executeQuery)).resolves.toEqual({
      id: 42,
      username: "Adam",
      displayName: "Adam",
      booksCount: 321,
    });
    expect(executeQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        operationName: "PublicProfile",
        variables: { username: "adam" },
      }),
    );
  });

  it("rejects a followers-only or private profile", async () => {
    const executeQuery: HardcoverQueryExecutor = vi.fn().mockResolvedValue({
      users: [
        {
          id: 42,
          username: "private-reader",
          name: null,
          books_count: 1,
          account_privacy_setting_id: 2,
        },
      ],
    });

    await expect(
      validatePublicProfile("private-reader", executeQuery),
    ).rejects.toBeInstanceOf(ProfileNotPublicError);
  });

  it("rejects an unknown username", async () => {
    const executeQuery: HardcoverQueryExecutor = vi.fn().mockResolvedValue({
      users: [],
    });

    await expect(
      validatePublicProfile("missing-reader", executeQuery),
    ).rejects.toBeInstanceOf(ProfileNotFoundError);
  });

  it("rejects a malformed upstream response", async () => {
    const executeQuery: HardcoverQueryExecutor = vi.fn().mockResolvedValue({
      users: [{ id: "not-a-number" }],
    });

    await expect(
      validatePublicProfile("adam", executeQuery),
    ).rejects.toMatchObject({ code: "HARDCOVER_INVALID_RESPONSE" });
  });
});
