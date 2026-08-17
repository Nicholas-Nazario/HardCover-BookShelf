import { describe, expect, it, vi } from "vitest";
import { executeHardcoverQuery, type HardcoverQuery } from "./client";
import { HardcoverError } from "./errors";

const environment = {
  hardcoverApiToken: "super-secret-token",
  hardcoverApiUrl: "https://api.hardcover.app/v1/graphql",
};

const request: HardcoverQuery = {
  operationName: "TestQuery",
  query: "query TestQuery { me { id } }",
  variables: {},
};

describe("executeHardcoverQuery", () => {
  it("adds the bearer credential and returns GraphQL data", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ data: { me: [{ id: 1 }] } }),
    );

    await expect(
      executeHardcoverQuery(request, { environment, fetchImplementation }),
    ).resolves.toEqual({ me: [{ id: 1 }] });

    expect(fetchImplementation).toHaveBeenCalledWith(
      environment.hardcoverApiUrl,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer super-secret-token",
        }),
      }),
    );
  });

  it("maps an authentication failure without leaking the token", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("Unauthorized", { status: 401 }));

    const error = await executeHardcoverQuery(request, {
      environment,
      fetchImplementation,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HardcoverError);
    expect(error).toMatchObject({ code: "HARDCOVER_AUTHENTICATION_FAILED" });
    expect(String(error)).not.toContain(environment.hardcoverApiToken);
  });

  it("maps rate limits", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("Throttled", { status: 429 }));

    await expect(
      executeHardcoverQuery(request, { environment, fetchImplementation }),
    ).rejects.toMatchObject({ code: "HARDCOVER_RATE_LIMITED" });
  });

  it("rejects GraphQL errors", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ errors: [{ message: "A sensitive upstream error" }] }),
    );

    await expect(
      executeHardcoverQuery(request, { environment, fetchImplementation }),
    ).rejects.toMatchObject({ code: "HARDCOVER_QUERY_FAILED" });
  });

  it("rejects a non-JSON response", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("not json", { status: 200 }));

    await expect(
      executeHardcoverQuery(request, { environment, fetchImplementation }),
    ).rejects.toMatchObject({ code: "HARDCOVER_INVALID_RESPONSE" });
  });

  it("times out an unresponsive request", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );

    await expect(
      executeHardcoverQuery(request, {
        environment,
        fetchImplementation,
        timeoutMs: 5,
      }),
    ).rejects.toMatchObject({ code: "HARDCOVER_TIMEOUT" });
  });
});
