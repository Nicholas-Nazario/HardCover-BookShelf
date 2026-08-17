// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ImgHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShelfBookDto } from "../client/shelf-api";
import {
  BOOK_SPINE_PALETTE,
  bookSpineColor,
  bookSpinePaletteIndex,
} from "../shared/shelf-colors";
import {
  BookCard,
  SPINE_TITLE_WRAP_THRESHOLD_PX,
  bookCoverAspectRatio,
  bookHeightScale,
  bookSpineAreaUnits,
  bookSpineWidthRem,
  shouldWrapSpineTitle,
  splitBookTitle,
  splitSpineTitle,
  splitSpineTitleLines,
} from "./book-card";

vi.mock("next/image", () => ({
  default: ({
    fill,
    ...props
  }: ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img {...props} data-fill={fill ? "true" : undefined} />
  ),
}));

afterEach(cleanup);

describe("BookCard", () => {
  it("renders only the lazy cover until its accessible details trigger is opened", async () => {
    const user = userEvent.setup();
    renderCard(
      book({
        slug: "a book/with spaces",
        cover: {
          url: "https://assets.hardcover.app/covers/example.jpg",
          width: 400,
          height: 600,
        },
      }),
    );

    const trigger = screen.getByRole("button", {
      name: "Open details for A Complete Book Title by First Author, Second Author",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();

    const image = trigger.querySelector("img") as HTMLImageElement;
    expect(image.getAttribute("alt")).toBe("");
    expect(image.getAttribute("loading")).toBe("lazy");
    expect(image.getAttribute("width")).toBe("400");
    expect(image.getAttribute("height")).toBe("600");
    expect(image.getAttribute("sizes")).toContain("14vw");

    await user.click(trigger);
    const dialog = screen.getByRole("dialog", {
      name: "A Complete Book Title",
    });
    const link = screen.getByRole("link", { name: /View on Hardcover/ });
    expect(link.getAttribute("href")).toBe(
      "https://hardcover.app/books/a%20book%2Fwith%20spaces",
    );
    expect(dialog.contains(link)).toBe(true);
  });

  it("switches between a variable-width cover and generated spine", async () => {
    const user = userEvent.setup();
    const onPresentationChange = vi.fn();
    const value = book({
      pages: 432,
      cover: {
        url: "https://assets.hardcover.app/covers/example.jpg",
        width: 400,
        height: 600,
      },
    });
    const view = render(
      <ul>
        <BookCard
          book={value}
          presentation="cover"
          onPresentationChange={onPresentationChange}
        />
      </ul>,
    );

    let card = screen.getByRole("listitem") as HTMLElement;
    expect(card.dataset.presentation).toBe("cover");
    expect(card.style.getPropertyValue("--book-width")).toContain(
      String(400 / 600),
    );
    expect(card.querySelector(".book-spine")).toBeNull();

    await user.click(screen.getByRole("button", { name: /Open details/ }));
    expect((screen.getByRole("radio", { name: "Cover" }) as HTMLInputElement).checked)
      .toBe(true);
    await user.click(screen.getByRole("radio", { name: "Spine" }));
    expect(onPresentationChange).toHaveBeenCalledWith("spine");

    view.rerender(
      <ul>
        <BookCard
          book={value}
          presentation="spine"
          onPresentationChange={onPresentationChange}
        />
      </ul>,
    );

    card = screen.getByRole("listitem") as HTMLElement;
    expect(card.dataset.presentation).toBe("spine");
    expect(card.style.getPropertyValue("--book-width")).toBe(
      `${bookSpineWidthRem(value).toFixed(3)}rem`,
    );
    expect(card.querySelector(".book-spine-title--single")?.textContent).toBe(
      value.title,
    );
    expect(card.querySelector(".book-spine-author")?.textContent).toBe(
      "First Author, Second Author",
    );
    expect(card.querySelector(".book-spine-cover-image")).toBeTruthy();
    expect(card.style.getPropertyValue("--book-height")).toContain(
      bookHeightScale(value).toFixed(3),
    );
    expect((screen.getByRole("radio", { name: "Spine" }) as HTMLInputElement).checked)
      .toBe(true);
    expect(screen.getByRole("dialog").querySelector(".book-cover")).toBeTruthy();
  });

  it("derives cover proportions and bounded spine widths from book metadata", () => {
    expect(
      bookCoverAspectRatio(
        book({ cover: { url: "https://assets.hardcover.app/c.jpg", width: 5, height: 8 } }),
      ),
    ).toBe(5 / 8);
    expect(bookCoverAspectRatio(book({ cover: null }))).toBe(2 / 3);
    expect(bookSpineWidthRem(book({ pages: 1 }))).toBeGreaterThanOrEqual(2.25);
    expect(bookSpineWidthRem(book({ pages: 10_000 }))).toBe(9);
    const pageWidths = [100, 300, 600, 1_000].map((pages) =>
      bookSpineWidthRem(book({ pages })),
    );
    expect(pageWidths).toEqual([...pageWidths].sort((a, b) => a - b));
    expect(new Set(pageWidths).size).toBe(4);
    expect(pageWidths.at(-1)).toBeGreaterThan(5);
    const fallbackWidths = Array.from({ length: 24 }, (_, index) =>
      bookSpineWidthRem(book({ id: index + 1, pages: null })),
    );
    expect(new Set(fallbackWidths).size).toBe(24);
    expect(Math.max(...fallbackWidths) - Math.min(...fallbackWidths)).toBeGreaterThan(
      2.5,
    );
    expect(bookSpineWidthRem(book({ id: 101, pages: null }))).toBe(
      bookSpineWidthRem(book({ id: 101, pages: null })),
    );
  });

  it("gives books stable, varied heights derived from their cover proportions", () => {
    const values = Array.from({ length: 24 }, (_, index) =>
      bookHeightScale(
        book({
          id: index + 1,
          cover: {
            url: `https://assets.hardcover.app/covers/${index + 1}.jpg`,
            width: 300 + index * 5,
            height: 500,
          },
        }),
      ),
    );

    expect(values.every((value) => value >= 0.72 && value <= 1)).toBe(true);
    expect(new Set(values).size).toBe(24);
    expect(bookHeightScale(book({ id: 101 }))).toBe(
      bookHeightScale(book({ id: 101 })),
    );
  });

  it("relates spine area to page count while allowing extra room for text", () => {
    const shortBook = book({ id: 101, pages: 120, title: "Dune", authors: ["Frank Herbert"] });
    const longBook = book({ id: 101, pages: 720, title: "Dune", authors: ["Frank Herbert"] });
    const verboseBook = book({
      id: 101,
      pages: 120,
      title:
        "How To Hold a Cockroach and Understand What It Means to Be Free",
      authors: ["Matthew Maxwell", "Allie Daigle"],
    });
    const subtitledBook = book({
      id: 101,
      pages: 120,
      title:
        "Dune: A very long subtitle that should not affect the dimensions of the spine",
      authors: ["Frank Herbert"],
    });

    expect(bookSpineAreaUnits(longBook)).toBeGreaterThan(
      bookSpineAreaUnits(shortBook) * 2,
    );
    expect(bookSpineAreaUnits(verboseBook)).toBeGreaterThan(
      bookSpineAreaUnits(shortBook),
    );
    expect(bookSpineAreaUnits(subtitledBook)).toBe(
      bookSpineAreaUnits(shortBook),
    );
    expect(bookSpineWidthRem(longBook) * bookHeightScale(longBook)).toBeCloseTo(
      bookSpineAreaUnits(longBook),
      8,
    );
    expect(bookHeightScale(verboseBook)).toBeGreaterThan(
      bookHeightScale(shortBook),
    );
  });

  it("wraps the reported long title into balanced lines before type gets tiny", () => {
    const title =
      "How To Hold a Cockroach: A book for those who are free and don't know it";

    expect(splitSpineTitle(title)).toEqual([
      "How To Hold a Cockroach: A book for",
      "those who are free and don't know it",
    ]);
    expect(splitSpineTitleLines(title, 3)).toEqual([
      "How To Hold a Cockroach:",
      "A book for those who are",
      "free and don't know it",
    ]);
    expect(splitSpineTitle("Dune")).toEqual(["Dune", null]);
    expect(splitBookTitle(title)).toEqual({
      title: "How To Hold a Cockroach",
      subtitle: "A book for those who are free and don't know it",
    });
    expect(splitBookTitle("Dune")).toEqual({
      title: "Dune",
      subtitle: null,
    });
    expect(SPINE_TITLE_WRAP_THRESHOLD_PX).toBeGreaterThan(4.92);
    expect(shouldWrapSpineTitle(10.99, true)).toBe(true);
    expect(shouldWrapSpineTitle(11, true)).toBe(false);
    expect(shouldWrapSpineTitle(4.92, false)).toBe(false);

    const view = render(
      <ul>
        <BookCard
          book={book({
            title,
            authors: ["Matthew  Maxwell", "Allie Daigle"],
          })}
          presentation="spine"
        />
      </ul>,
    );
    expect(view.container.querySelector('.book-spine-author')?.textContent).toBe(
      "Matthew  Maxwell, Allie Daigle",
    );
    expect(
      view.container.querySelector(".book-spine-title--single")?.textContent,
    ).toBe("How To Hold a Cockroach");
    expect(view.container.querySelector(".book-spine-subtitle")).toBeNull();
  });

  it("separates a colon subtitle in the details dialog", async () => {
    const user = userEvent.setup();
    const title =
      "The Disappearing Spoon: And Other True Tales of Madness, Love, and the History of the World from the Periodic Table of the Elements";
    renderCard(book({ title, authors: ["Sam Kean"] }));

    await user.click(screen.getByRole("button", { name: /Open details/ }));
    expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    expect(document.querySelector(".book-dialog-title")?.textContent).toBe(
      "The Disappearing Spoon",
    );
    expect(document.querySelector(".book-dialog-subtitle")?.textContent).toBe(
      "And Other True Tales of Madness, Love, and the History of the World from the Periodic Table of the Elements",
    );
  });

  it("uses fill for a valid cover without complete dimensions", () => {
    renderCard(
      book({
        cover: {
          url: "https://assets.hardcover.app/covers/example.jpg",
          width: null,
          height: 600,
        },
      }),
    );

    expect((document.querySelector("img") as HTMLImageElement).dataset.fill).toBe(
      "true",
    );
  });

  it("shows the deterministic colored fallback for missing and failed covers", async () => {
    const user = userEvent.setup();
    const view = renderCard(book({ id: 101, cover: null }));
    let cover = view.container.querySelector(".book-cover") as HTMLElement;
    expect(cover.style.backgroundColor).not.toBe("");
    expect(view.container.querySelector("img")).toBeNull();

    view.rerender(
      <ul>
        <BookCard
          book={book({
            id: 101,
            cover: {
              url: "https://assets.hardcover.app/covers/broken.jpg",
              width: 400,
              height: 600,
            },
          })}
        />
      </ul>,
    );
    fireEvent.error(view.container.querySelector("img") as HTMLImageElement);
    expect(view.container.querySelector("img")).toBeNull();
    cover = view.container.querySelector(".book-cover") as HTMLElement;
    expect(cover.style.backgroundColor).not.toBe("");
    expect(screen.queryByRole("heading", { name: "A Complete Book Title" })).toBeNull();
    await user.click(screen.getByRole("button", { name: /Open details/ }));
    expect(screen.getByRole("heading", { name: "A Complete Book Title" })).toBeTruthy();
    expect(screen.getByText("First Author, Second Author")).toBeTruthy();
  });

  it("does not render a dead anchor when the slug is missing", async () => {
    const user = userEvent.setup();
    renderCard(book({ slug: null, cover: null }));
    expect(screen.queryByRole("link")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Open details/ }));
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows multiple authors and the visible Unknown author fallback in details", async () => {
    const user = userEvent.setup();
    const view = renderCard(book());
    expect(screen.queryByText("First Author, Second Author")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Open details/ }));
    expect(screen.getByText("First Author, Second Author")).toBeTruthy();

    view.rerender(
      <ul>
        <BookCard book={book({ title: "Anonymous Work", authors: [] })} />
      </ul>,
    );
    await user.click(screen.getByRole("button", { name: /Open details/ }));
    expect(screen.getByText("Unknown author")).toBeTruthy();
  });

  it("shows featured series positions and exposes all series accessibly", async () => {
    const user = userEvent.setup();
    renderCard(
      book({
        series: [
          { id: 1, name: "The Expanse", position: 3, featured: true },
          { id: 2, name: "Shared Worlds", position: 1.5, featured: false },
        ],
      }),
    );

    await user.click(screen.getByRole("button", { name: /Open details/ }));
    const series = document.querySelector(".book-detail-list dd") as HTMLElement;
    expect(series.textContent).toBe("The Expanse #3 +1 more");
    expect(series.getAttribute("aria-label")).toBe(
      "The Expanse #3, Shared Worlds #1.5",
    );
  });

  it.each([
    [{ releaseYear: 2013, pages: null }, "2013"],
    [{ releaseYear: null, pages: 432 }, "432 pages"],
    [{ releaseYear: 2013, pages: 432 }, "2013 · 432 pages"],
  ] as const)("collapses publication facts cleanly", async (metadata, expected) => {
    const user = userEvent.setup();
    renderCard(book(metadata));
    await user.click(screen.getByRole("button", { name: /Open details/ }));
    expect(screen.getByText(expected)).toBeTruthy();
  });

  it("keeps community and reader ratings visibly distinct", async () => {
    const user = userEvent.setup();
    renderCard(
      book({
        communityRating: 4.18,
        ratingsCount: 2_431,
        userRating: 4.5,
      }),
    );

    await user.click(screen.getByRole("button", { name: /Open details/ }));
    expect(
      document.querySelector(".book-rating-grid")?.textContent,
    ).toContain("4.18 ★Community · 2,431 ratings");
    expect(document.querySelector(".book-rating-grid")?.textContent).toContain(
      "4.5 ★Your rating",
    );
  });

  it.each([
    ["2025-05-12", null, "Read May 12, 2025"],
    [null, "2025-05-12", "Read May 12, 2025"],
    ["2025-05-12", "2025-05-12", "Read May 12, 2025"],
    [
      "2024-01-02",
      "2025-05-12",
      "First read Jan 2, 2024 · Last read May 12, 2025",
    ],
  ])("formats first and last read dates", async (firstReadDate, lastReadDate, expected) => {
    const user = userEvent.setup();
    renderCard(book({ firstReadDate, lastReadDate }));
    await user.click(screen.getByRole("button", { name: /Open details/ }));
    expect(screen.getByText(expected)).toBeTruthy();
  });

  it("omits every optional metadata line without empty separators or zero placeholders", async () => {
    const user = userEvent.setup();
    renderCard(book());
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Open details/ }));
    expect(document.querySelector(".book-detail-list")).toBeNull();
    expect(document.querySelector(".book-rating-grid")).toBeNull();
    expect(document.body.textContent).not.toContain("null");
    expect(document.body.textContent).not.toContain("0 pages");
  });

  it("closes details with Escape and returns focus to the cover", async () => {
    const user = userEvent.setup();
    renderCard(book());
    const trigger = screen.getByRole("button", { name: /Open details/ });

    await user.click(trigger);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /Close details/ }),
    );
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: /View on Hardcover/ }),
    );
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /Close details/ }),
    );

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("selects stable fallback colors from the fixed palette", () => {
    const firstPass = Array.from({ length: 24 }, (_, index) =>
      bookSpineColor(index + 1),
    );
    const secondPass = Array.from({ length: 24 }, (_, index) =>
      bookSpineColor(index + 1),
    );

    expect(secondPass).toEqual(firstPass);
    expect(new Set(firstPass).size).toBeGreaterThan(1);
    expect(
      firstPass.every((color) =>
        BOOK_SPINE_PALETTE.some((paletteColor) => paletteColor === color),
      ),
    ).toBe(true);
    expect(bookSpinePaletteIndex(101)).toBe(bookSpinePaletteIndex(101));
  });
});

function renderCard(value: ShelfBookDto) {
  return render(
    <ul>
      <BookCard book={value} />
    </ul>,
  );
}

function book(overrides: Partial<ShelfBookDto> = {}): ShelfBookDto {
  return {
    id: 101,
    title: "A Complete Book Title",
    authors: ["First Author", "Second Author"],
    slug: "a-complete-book-title",
    cover: null,
    releaseYear: null,
    pages: null,
    communityRating: null,
    ratingsCount: 0,
    series: [],
    userRating: null,
    firstReadDate: null,
    lastReadDate: null,
    ...overrides,
  };
}
