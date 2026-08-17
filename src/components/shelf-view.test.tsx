// @vitest-environment jsdom

import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadBookPresentationPreferences } from "../client/book-presentations";
import { SHELF_THEME_COOKIE_NAME } from "../shared/shelf-themes";
import { ShelfView } from "./shelf-view";

const emptyBookMetadata = {
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
};

const snapshot = {
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
        ...emptyBookMetadata,
      },
      {
        id: 2,
        title: "Another Read Book",
        authors: ["Third Author"],
        ...emptyBookMetadata,
      },
    ],
    wantToRead: [
      {
        id: 3,
        title: "Wanted Book",
        authors: ["Wanted Author"],
        ...emptyBookMetadata,
      },
    ],
  },
};

const refreshedSnapshot = {
  profile: {
    username: "Adam",
    displayName: "Adam Reader",
    lastSyncedAt: "2026-08-17T13:00:00.000Z",
  },
  shelves: {
    read: [
      ...snapshot.shelves.read,
      {
        id: 4,
        title: "New Read Book",
        authors: ["New Author"],
        ...emptyBookMetadata,
      },
    ],
    wantToRead: [],
  },
};

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.cookie = `${SHELF_THEME_COOKIE_NAME}=; Path=/; Max-Age=0`;
  vi.unstubAllGlobals();
});

describe("ShelfView", () => {
  it("loads cached profile metadata and the default Read cards without syncing", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(200, snapshot));
    vi.stubGlobal("fetch", fetchMock);

    render(<ShelfView username="@Adam" />);

    const shelfHeading = await screen.findByRole("heading", {
      name: "Adam Reader's bookshelf",
    });
    const shelfScene = shelfHeading.closest(".shelf-page") as HTMLElement;
    expect(shelfScene.dataset.shelfTheme).toBe("heritage");
    expect(shelfScene.dataset.shelfOverlays).toBe("wood-grain");
    expect(shelfScene.style.getPropertyValue("--shelf-row-height")).toContain(
      "clamp",
    );
    expect(screen.getByText("@Adam")).toBeTruthy();
    expect(screen.getByText("2026-08-17T12:00:00.000Z")).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: "Read (2)" }).getAttribute(
        "aria-selected",
      ),
    ).toBe("true");
    expect(screen.getByRole("tab", { name: "Want to Read (1)" })).toBeTruthy();
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(
      "read-tab",
    );
    const readSpine = screen.getByRole("listitem", {
      name: "Read Book by First Author, Second Author",
    });
    expect(
      within(readSpine).getByRole("button", {
        name: "Open details for Read Book by First Author, Second Author",
      }),
    ).toBeTruthy();
    expect(within(readSpine).queryByRole("heading")).toBeNull();
    expect(
      screen.getByRole("list", { name: "Read bookshelf" }).classList.contains(
        "bookshelf",
      ),
    ).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/profiles/%40Adam/books",
    );
  });

  it("visibly synchronizes a first-time profile before displaying it", async () => {
    let resolveSynchronization!: (response: Response) => void;
    const synchronization = new Promise<Response>((resolve) => {
      resolveSynchronization = resolve;
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(404, {
          error: { code: "SNAPSHOT_NOT_FOUND", message: "No snapshot." },
        }),
      )
      .mockReturnValueOnce(synchronization)
      .mockResolvedValueOnce(jsonResponse(200, snapshot));
    vi.stubGlobal("fetch", fetchMock);

    render(<ShelfView username="adam" />);

    expect(
      await screen.findByText(
        "No cached shelf was found. Synchronizing every public book…",
      ),
    ).toBeTruthy();

    await act(async () => {
      resolveSynchronization(
        jsonResponse(200, {
          profile: { username: "Adam", displayName: "Adam Reader" },
          counts: { read: 2, wantToRead: 1 },
          lastSyncedAt: "2026-08-17T12:00:00.000Z",
        }),
      );
    });

    expect(
      await screen.findByRole("heading", {
        name: "Adam Reader's bookshelf",
      }),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/profiles/adam/sync");
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/profiles/adam/books");
  });

  it("switches between one visible card shelf at a time with pointer input", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(200, snapshot)),
    );
    const user = userEvent.setup();
    render(<ShelfView username="adam" />);

    const wantToReadTab = await screen.findByRole("tab", {
      name: "Want to Read (1)",
    });
    await user.click(wantToReadTab);

    expect(wantToReadTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(
      "want-to-read-tab",
    );
    expect(
      screen.getByRole("listitem", {
        name: "Wanted Book by Wanted Author",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Open details for Wanted Book by Wanted Author",
      }),
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Wanted Book" })).toBeNull();
    expect(screen.getByRole("list", { name: "Want to Read bookshelf" })).toBeTruthy();
  });

  it("portals book details above the shelf instead of inside a book card", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(200, snapshot)),
    );
    const user = userEvent.setup();
    render(<ShelfView username="adam" />);

    const trigger = await screen.findByRole("button", {
      name: "Open details for Read Book by First Author, Second Author",
    });
    const shelfScene = trigger.closest(".shelf-page");
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Read Book" });
    expect(dialog.closest(".book-card")).toBeNull();
    expect(dialog.parentElement?.parentElement).toBe(shelfScene);
  });

  it("configures any book as a spine and restores that choice for the profile", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(200, snapshot)),
    );
    const user = userEvent.setup();
    const firstView = render(<ShelfView username="adam" />);

    const trigger = await screen.findByRole("button", {
      name: "Open details for Read Book by First Author, Second Author",
    });
    const card = trigger.closest(".book-card") as HTMLElement;
    expect(card.dataset.presentation).toBe("cover");

    await user.click(trigger);
    await user.click(screen.getByRole("radio", { name: "Spine" }));
    expect(card.dataset.presentation).toBe("spine");
    expect(card.querySelector(".book-spine")).toBeTruthy();
    expect(loadBookPresentationPreferences(localStorage, "Adam")).toEqual({
      1: "spine",
    });

    firstView.unmount();
    render(<ShelfView username="adam" />);

    const restoredCard = (
      await screen.findByRole("button", {
        name: "Open details for Read Book by First Author, Second Author",
      })
    ).closest(".book-card") as HTMLElement;
    expect(restoredCard.dataset.presentation).toBe("spine");
    expect(restoredCard.querySelector(".book-spine-title")?.textContent).toBe(
      "Read Book",
    );
  });

  it("uses subtle icon actions and opens the configured theme settings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(200, snapshot)),
    );
    const user = userEvent.setup();
    render(<ShelfView username="adam" />);

    const refresh = await screen.findByRole("button", { name: "Refresh shelf" });
    const settings = screen.getByRole("button", { name: "Shelf settings" });
    expect(refresh.textContent).toBe("");
    expect(settings.textContent).toBe("");

    await user.click(settings);
    expect(
      screen.getByRole("dialog", { name: "Shelf settings" }),
    ).toBeTruthy();
    const walnut = screen.getByRole("radio", { name: /Wood - Walnut/ });
    const pine = screen.getByRole("radio", { name: /Wood - Pine/ });
    const metalBlack = screen.getByRole("radio", { name: /Metal - Black/ });
    expect((walnut as HTMLInputElement).checked).toBe(true);
    expect((pine as HTMLInputElement).checked).toBe(false);
    expect((metalBlack as HTMLInputElement).checked).toBe(false);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close shelf settings" }),
    );

    await user.click(pine);
    const shelfScene = screen
      .getByRole("heading", { name: "Adam Reader's bookshelf" })
      .closest(".shelf-page") as HTMLElement;
    expect((pine as HTMLInputElement).checked).toBe(true);
    expect(shelfScene.dataset.shelfTheme).toBe("pine");
    expect(shelfScene.dataset.shelfOverlays).toBe("wood-grain");
    expect(shelfScene.style.getPropertyValue("--shelf-room")).toBe("#e9dfca");
    expect(shelfScene.style.getPropertyValue("--shelf-toolbar")).toContain(
      "255 249 236",
    );
    expect(document.cookie).toContain(`${SHELF_THEME_COOKIE_NAME}=pine`);

    await user.click(metalBlack);
    expect((metalBlack as HTMLInputElement).checked).toBe(true);
    expect(shelfScene.dataset.shelfTheme).toBe("metalBlack");
    expect(shelfScene.hasAttribute("data-shelf-overlays")).toBe(false);
    expect(shelfScene.style.getPropertyValue("--shelf-room")).toBe("#080a0d");
    expect(shelfScene.style.getPropertyValue("--shelf-material-face")).toBe(
      "#2c3036",
    );
    expect(document.cookie).toContain(
      `${SHELF_THEME_COOKIE_NAME}=metalBlack`,
    );

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Shelf settings" })).toBeNull();
    expect(document.activeElement).toBe(settings);
  });

  it("uses Unknown author in the full accessible cover label", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(200, {
          ...snapshot,
          shelves: {
            ...snapshot.shelves,
            read: [
              {
                id: 11,
                title: "Authorless Book",
                authors: [],
                ...emptyBookMetadata,
              },
            ],
          },
        }),
      ),
    );

    render(<ShelfView username="adam" />);

    const spine = await screen.findByRole("listitem", {
      name: "Authorless Book by Unknown author",
    });
    expect(
      within(spine).getByRole("button", {
        name: "Open details for Authorless Book by Unknown author",
      }),
    ).toBeTruthy();
    expect(within(spine).queryByText("Unknown author")).toBeNull();
  });

  it("keeps a book color stable across rerenders", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(200, snapshot)),
    );
    const view = render(<ShelfView username="adam" />);
    const spine = await screen.findByRole("listitem", {
      name: "Read Book by First Author, Second Author",
    });
    const initialColor = (
      spine.querySelector(".book-cover") as HTMLElement
    ).style.backgroundColor;

    view.rerender(<ShelfView username="adam" />);

    expect(
      screen.getByRole("listitem", {
        name: "Read Book by First Author, Second Author",
      }).querySelector<HTMLElement>(".book-cover")?.style.backgroundColor,
    ).toBe(initialColor);
    expect(initialColor).not.toBe("");
  });

  it("keeps the current shelf visible while refreshing and replaces it only after success", async () => {
    let resolveSynchronization!: (response: Response) => void;
    const synchronization = new Promise<Response>((resolve) => {
      resolveSynchronization = resolve;
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(200, snapshot))
      .mockReturnValueOnce(synchronization)
      .mockResolvedValueOnce(jsonResponse(200, refreshedSnapshot));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ShelfView username="adam" />);

    const refreshButton = await screen.findByRole("button", {
      name: "Refresh shelf",
    });
    await user.click(refreshButton);

    expect(
      (screen.getByRole("button", { name: "Refreshing…" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      screen.getByRole("status").textContent,
    ).toBe("Refreshing the shelf. The current books remain available.");
    expect(
      screen.getByRole("listitem", {
        name: "Read Book by First Author, Second Author",
      }),
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "New Read Book" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveSynchronization(
        jsonResponse(200, {
          profile: { username: "Adam", displayName: "Adam Reader" },
          counts: { read: 3, wantToRead: 0 },
          lastSyncedAt: "2026-08-17T13:00:00.000Z",
        }),
      );
    });

    expect(
      await screen.findByRole("listitem", {
        name: "New Read Book by New Author",
      }),
    ).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Read (3)" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Want to Read (0)" })).toBeTruthy();
    expect(screen.getByText("2026-08-17T13:00:00.000Z")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe(
      "Shelf refreshed. The latest books are now shown.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/profiles/adam/sync");
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/profiles/adam/books");
  });

  it("prevents duplicate refreshes and supports keyboard activation", async () => {
    const synchronization = new Promise<Response>(() => undefined);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(200, snapshot))
      .mockReturnValueOnce(synchronization);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ShelfView username="adam" />);

    await screen.findByRole("heading", {
      name: "Adam Reader's bookshelf",
    });
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: /Choose another profile/ }),
    );
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "Read (2)" }),
    );
    await user.tab();
    const refreshButton = screen.getByRole("button", { name: "Refresh shelf" });
    expect(document.activeElement).toBe(refreshButton);
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Refreshing…" }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.filter(([path]) =>
        String(path).endsWith("/sync"),
      ),
    ).toHaveLength(1);
  });

  it("retains the last good shelf and shows a safe refresh failure", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(200, snapshot))
      .mockResolvedValueOnce(
        jsonResponse(503, {
          error: {
            code: "HARDCOVER_TEMPORARILY_UNAVAILABLE",
            message: "Raw upstream details must not render.",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ShelfView username="adam" />);

    await user.click(
      await screen.findByRole("button", { name: "Refresh shelf" }),
    );

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Refresh failed. Hardcover is temporarily unavailable. Try again shortly. The last synchronized shelf is still shown.",
    );
    expect(
      screen.getByRole("listitem", {
        name: "Read Book by First Author, Second Author",
      }),
    ).toBeTruthy();
    expect(screen.getByText("2026-08-17T12:00:00.000Z")).toBeTruthy();
    expect(screen.queryByText("Raw upstream details must not render.")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Refresh shelf" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("shows a clear empty state for an empty Read shelf", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(200, {
          ...snapshot,
          shelves: { ...snapshot.shelves, read: [] },
        }),
      ),
    );

    render(<ShelfView username="adam" />);

    expect(
      await screen.findByText("No Read books are on this shelf."),
    ).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Read bookshelf" })).toBeNull();
  });

  it("shows a clear empty state for an empty Want to Read shelf", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(200, {
          ...snapshot,
          shelves: { ...snapshot.shelves, wantToRead: [] },
        }),
      ),
    );
    const user = userEvent.setup();
    render(<ShelfView username="adam" />);

    await user.click(
      await screen.findByRole("tab", { name: "Want to Read (0)" }),
    );

    expect(
      screen.getByText("No Want to Read books are on this shelf."),
    ).toBeTruthy();
    expect(
      screen.queryByRole("list", { name: "Want to Read bookshelf" }),
    ).toBeNull();
  });

  it("supports arrow, Home, and End keyboard tab selection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(200, snapshot)),
    );
    const user = userEvent.setup();
    render(<ShelfView username="adam" />);

    const readTab = await screen.findByRole("tab", { name: "Read (2)" });
    const wantToReadTab = screen.getByRole("tab", {
      name: "Want to Read (1)",
    });
    readTab.focus();
    await user.keyboard("{ArrowRight}");

    expect(document.activeElement).toBe(wantToReadTab);
    expect(wantToReadTab.getAttribute("aria-selected")).toBe("true");

    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(readTab);
    expect(readTab.getAttribute("aria-selected")).toBe("true");

    await user.keyboard("{End}");
    expect(document.activeElement).toBe(wantToReadTab);
  });

  it.each([
    {
      field: "cover",
      value: {
        url: "https://example.com/cover.jpg",
        width: 400,
        height: 600,
      },
    },
    {
      field: "series",
      value: [
        { id: 1, name: "Series", position: "first", featured: true },
      ],
    },
    { field: "communityRating", value: 6 },
    { field: "userRating", value: Number.NaN },
    { field: "ratingsCount", value: -1 },
    { field: "firstReadDate", value: "May 12, 2025" },
  ])("rejects a malformed $field in the complete browser DTO", async ({ field, value }) => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(200, {
          ...snapshot,
          shelves: {
            ...snapshot.shelves,
            read: [
              {
                ...snapshot.shelves.read[0],
                [field]: value,
              },
            ],
          },
        }),
      ),
    );

    render(<ShelfView username="adam" />);

    expect((await screen.findByRole("alert")).textContent).toBe(
      "The server returned an unexpected response.",
    );
  });

  it.each([
    {
      code: "PROFILE_NOT_FOUND",
      expected: "No Hardcover profile was found for that username.",
      status: 404,
    },
    {
      code: "PROFILE_NOT_PUBLIC",
      expected: "That Hardcover profile is not public.",
      status: 403,
    },
    {
      code: "HARDCOVER_TEMPORARILY_UNAVAILABLE",
      expected: "Hardcover is temporarily unavailable. Try again shortly.",
      status: 503,
    },
    {
      code: "HARDCOVER_UNAVAILABLE",
      expected: "Hardcover could not complete this request.",
      status: 502,
    },
  ])("shows the $code first-load error safely", async ({ code, expected, status }) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(404, {
          error: { code: "SNAPSHOT_NOT_FOUND", message: "No snapshot." },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(status, {
          error: { code, message: "Raw response message must not render." },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<ShelfView username="reader" />);

    expect((await screen.findByRole("alert")).textContent).toBe(expected);
    expect(screen.queryByText("Raw response message must not render.")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}
