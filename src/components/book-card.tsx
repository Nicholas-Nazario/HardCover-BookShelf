"use client";

import Image from "next/image";
import type {
  DraggableAttributes,
  DraggableSyntheticListeners,
} from "@dnd-kit/core";
import { ExternalLink, X } from "lucide-react";
import { createPortal } from "react-dom";
import {
  type CSSProperties,
  type MouseEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { BookPresentation } from "../client/book-presentations";
import type { BookOrientation } from "../client/shelf-layout";
import type { ShelfBookDto } from "../client/shelf-api";
import { bookSpineColor } from "../shared/shelf-colors";

export interface BookCardProps {
  book: ShelfBookDto;
  eager?: boolean;
  presentation?: BookPresentation;
  orientation?: BookOrientation;
  stackIndex?: number;
  isStacked?: boolean;
  stackOffsetRem?: number;
  isEditing?: boolean;
  isSelectedForEditing?: boolean;
  onSelectForEditing?: () => void;
  drag?: {
    attributes: DraggableAttributes;
    listeners: DraggableSyntheticListeners | undefined;
    setNodeRef: (node: HTMLElement | null) => void;
    isDragging: boolean;
    isDropPreview: boolean;
    handleLabel?: string;
    handleOnly?: boolean;
  };
}

interface CoverArtworkProps {
  book: ShelfBookDto;
  eager?: boolean;
  sizes: string;
}

const SHELF_COVER_SIZES =
  "(max-width: 30rem) 29vw, (max-width: 72rem) 14vw, 11.5rem";
const DETAIL_COVER_SIZES = "(max-width: 42rem) 42vw, 16rem";
const DEFAULT_COVER_ASPECT_RATIO = 2 / 3;
const MIN_SPINE_WIDTH_REM = 2.25;
const MAX_SPINE_WIDTH_REM = 9;
const MAX_SPINE_FONT_SIZE_PX = 20;
const MIN_SPINE_FONT_SIZE_PX = 1;
export const SPINE_TITLE_WRAP_THRESHOLD_PX = 11;

type BookCardStyle = CSSProperties & Record<`--${string}`, string>;

const spineResizeCallbacks = new WeakMap<Element, () => void>();
let spineResizeObserver: ResizeObserver | null = null;

const numberFormatter = new Intl.NumberFormat(undefined);
const ratingFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
});
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function formatBookCardLabel(book: ShelfBookDto): string {
  return `${book.title} by ${formatAuthors(book.authors)}`;
}

export function BookCard({
  book,
  eager = false,
  presentation = "cover",
  orientation = "vertical",
  stackIndex,
  isStacked = false,
  stackOffsetRem = 0,
  isEditing = false,
  isSelectedForEditing = false,
  onSelectForEditing,
  drag,
}: BookCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const generatedId = useId();
  const titleId = `book-details-${generatedId}`;
  const displayTitle = splitBookTitle(book.title);
  const label = formatBookCardLabel(book);
  const hardcoverUrl = book.slug
    ? `https://hardcover.app/books/${encodeURIComponent(book.slug)}`
    : null;
  const series = book.series[0];
  const readDates = formatReadDates(book.firstReadDate, book.lastReadDate);
  const cardStyle = {
    ...bookCardStyle(book, presentation, orientation),
    ...(isStacked
      ? { "--stack-offset": `${stackOffsetRem.toFixed(3)}rem` }
      : {}),
  };
  const publicationFacts = [
    book.releaseYear === null ? null : String(book.releaseYear),
    book.pages === null
      ? null
      : `${numberFormatter.format(book.pages)} ${book.pages === 1 ? "page" : "pages"}`,
  ].filter((fact): fact is string => fact !== null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();

    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        closeDetails();
        return;
      }

      if (event.key !== "Tab" || !dialog.current) {
        return;
      }

      const focusable = Array.from(
        dialog.current.querySelectorAll<HTMLElement>(
          'a[href], input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      const first = focusable[0];
      const last = focusable.at(-1);

      if (!first || !last) {
        return;
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
      trigger.current?.focus();
    };
  }, [isOpen]);

  function closeFromBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      closeDetails();
    }
  }

  function closeDetails() {
    setIsOpen(false);
  }

  const CardElement = isStacked ? "div" : "li";

  return (
    <CardElement
      className={`book-card book-card--${presentation} book-card--${orientation}`}
      data-book-id={book.id}
      data-presentation={presentation}
      data-orientation={orientation}
      data-stack-index={stackIndex}
      data-stacked={isStacked || undefined}
      data-editing={isEditing || undefined}
      data-selected-for-editing={isSelectedForEditing || undefined}
      data-dragging={drag?.isDragging || undefined}
      data-drop-preview={drag?.isDropPreview || undefined}
      ref={drag?.setNodeRef}
      style={cardStyle}
      aria-label={label}
    >
      <button
        ref={trigger}
        className="book-cover-button"
        type="button"
        aria-label={
          isEditing
            ? `Select ${label} for appearance editing`
            : `Open details for ${label}`
        }
        aria-haspopup={isEditing ? undefined : "dialog"}
        aria-pressed={isEditing ? isSelectedForEditing : undefined}
        {...(!drag?.handleOnly ? drag?.attributes : undefined)}
        {...(!drag?.handleOnly ? drag?.listeners : undefined)}
        onClick={() => {
          if (isEditing) {
            onSelectForEditing?.();
          } else {
            setIsOpen(true);
          }
        }}
      >
        {orientation === "horizontal" || presentation === "spine" ? (
          <SpineArtwork book={book} eager={eager} />
        ) : (
          <CoverArtwork book={book} eager={eager} sizes={SHELF_COVER_SIZES} />
        )}
      </button>

      {drag?.handleOnly ? (
        <button
          className="book-drag-handle"
          type="button"
          aria-label={drag.handleLabel ?? `Move ${label}`}
          title={drag.handleLabel ?? `Move ${label}`}
          {...drag.attributes}
          {...drag.listeners}
        >
          <span aria-hidden="true">↕</span>
        </button>
      ) : null}

      {isOpen
        ? createPortal(
            <div
              className="book-dialog-backdrop"
              role="presentation"
              onMouseDown={closeFromBackdrop}
            >
              <article
                ref={dialog}
                className="book-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
              >
                <button
                  ref={closeButton}
                  className="book-dialog-close"
                  type="button"
                  aria-label={`Close details for ${book.title}`}
                  onClick={closeDetails}
                >
                  <X aria-hidden="true" />
                </button>

                <div className="book-dialog-cover" aria-hidden="true">
                  <CoverArtwork book={book} sizes={DETAIL_COVER_SIZES} />
                </div>

                <div className="book-dialog-copy">
                  <p className="book-dialog-kicker">From the shelf</p>
                  <h2 id={titleId} aria-label={book.title}>
                    <span className="book-dialog-title">
                      {displayTitle.title}
                    </span>
                    {displayTitle.subtitle ? (
                      <span className="book-dialog-subtitle">
                        {displayTitle.subtitle}
                      </span>
                    ) : null}
                  </h2>
                  <p className="book-dialog-authors">
                    {formatAuthors(book.authors)}
                  </p>

                  {book.communityRating !== null || book.userRating !== null ? (
                    <div className="book-rating-grid" aria-label="Book ratings">
                      {book.communityRating !== null ? (
                        <div>
                          <span className="book-rating-value">
                            {ratingFormatter.format(book.communityRating)}
                            <span aria-hidden="true"> ★</span>
                          </span>
                          <span>
                            Community · {numberFormatter.format(book.ratingsCount)}{" "}
                            {book.ratingsCount === 1 ? "rating" : "ratings"}
                          </span>
                        </div>
                      ) : null}
                      {book.userRating !== null ? (
                        <div>
                          <span className="book-rating-value">
                            {ratingFormatter.format(book.userRating)}
                            <span aria-hidden="true"> ★</span>
                          </span>
                          <span>Your rating</span>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {series || publicationFacts.length > 0 || readDates ? (
                    <dl className="book-detail-list">
                      {series ? (
                        <div>
                          <dt>Series</dt>
                          <dd aria-label={book.series.map(formatSeries).join(", ")}>
                            {formatSeries(series)}
                            {book.series.length > 1
                              ? ` +${book.series.length - 1} more`
                              : ""}
                          </dd>
                        </div>
                      ) : null}
                      {publicationFacts.length > 0 ? (
                        <div>
                          <dt>Edition</dt>
                          <dd>{publicationFacts.join(" · ")}</dd>
                        </div>
                      ) : null}
                      {readDates ? (
                        <div>
                          <dt>Reading history</dt>
                          <dd>{readDates}</dd>
                        </div>
                      ) : null}
                    </dl>
                  ) : null}

                  {hardcoverUrl ? (
                    <a className="book-hardcover-link" href={hardcoverUrl}>
                      View on Hardcover <ExternalLink aria-hidden="true" />
                    </a>
                  ) : null}
                </div>
              </article>
            </div>,
            trigger.current?.closest<HTMLElement>(".shelf-page") ??
              document.body,
          )
        : null}
    </CardElement>
  );
}

function CoverArtwork({ book, eager = false, sizes }: CoverArtworkProps) {
  const [failedCoverUrl, setFailedCoverUrl] = useState<string | null>(null);
  const cover = book.cover;

  return (
    <span
      className="book-cover"
      style={{
        aspectRatio: String(bookCoverAspectRatio(book)),
        backgroundColor: bookSpineColor(book.id),
      }}
    >
      <span className="book-cover-fallback" aria-hidden="true">
        <span>{book.title}</span>
      </span>
      {cover && failedCoverUrl !== cover.url ? (
        cover.width !== null && cover.height !== null ? (
          <Image
            className="book-cover-image"
            src={cover.url}
            width={cover.width}
            height={cover.height}
            sizes={sizes}
            loading={eager ? "eager" : "lazy"}
            alt=""
            onError={() => setFailedCoverUrl(cover.url)}
          />
        ) : (
          <Image
            className="book-cover-image"
            src={cover.url}
            fill
            sizes={sizes}
            loading={eager ? "eager" : "lazy"}
            alt=""
            onError={() => setFailedCoverUrl(cover.url)}
          />
        )
      ) : null}
    </span>
  );
}

function SpineArtwork({ book, eager }: { book: ShelfBookDto; eager: boolean }) {
  const frame = useRef<HTMLSpanElement>(null);
  const copy = useRef<HTMLSpanElement>(null);
  const [failedCoverUrl, setFailedCoverUrl] = useState<string | null>(null);
  const cover = book.cover;
  const displayTitle = splitBookTitle(book.title);
  const twoTitleLines = splitSpineTitleLines(displayTitle.title, 2);
  const threeTitleLines = splitSpineTitleLines(displayTitle.title, 3);

  const fitText = useCallback(() => {
    const frameElement = frame.current;
    const copyElement = copy.current;

    if (!frameElement || !copyElement || copyElement.clientWidth <= 0) {
      return;
    }

    copyElement.dataset.wrapped = "false";
    copyElement.dataset.titleLines = "1";
    let fontSize = largestFittingSpineFontSize(copyElement);

    if (shouldWrapSpineTitle(fontSize, twoTitleLines.length > 1)) {
      copyElement.dataset.wrapped = "true";
      let bestLineCount = 1;

      if (twoTitleLines.length > 1) {
        copyElement.dataset.titleLines = "2";
        const twoLineFontSize = largestFittingSpineFontSize(copyElement);

        if (twoLineFontSize > fontSize) {
          bestLineCount = 2;
          fontSize = twoLineFontSize;
        }
      }

      if (threeTitleLines.length > twoTitleLines.length) {
        copyElement.dataset.titleLines = "3";
        const threeLineFontSize = largestFittingSpineFontSize(copyElement);

        if (threeLineFontSize > fontSize) {
          bestLineCount = 3;
          fontSize = threeLineFontSize;
        }
      }

      copyElement.dataset.titleLines = String(bestLineCount);
    }

    frameElement.style.setProperty(
      "--spine-font-size",
      `${fontSize.toFixed(2)}px`,
    );
    copyElement.style.fontSize = "";
  }, [threeTitleLines.length, twoTitleLines.length]);

  useLayoutEffect(() => {
    const frameElement = frame.current;

    if (!frameElement) {
      return;
    }

    fitText();
    observeSpineResize(frameElement, fitText);
    void document.fonts?.ready.then(fitText);

    return () => unobserveSpineResize(frameElement);
  }, [book.authors, book.title, fitText]);

  return (
    <span className="book-spine" aria-hidden="true">
      {cover && failedCoverUrl !== cover.url ? (
        <Image
          className="book-spine-cover-image"
          src={cover.url}
          fill
          sizes="7rem"
          loading={eager ? "eager" : "lazy"}
          alt=""
          onError={() => setFailedCoverUrl(cover.url)}
        />
      ) : null}
      <span className="book-spine-glaze" />
      <span ref={frame} className="book-spine-copy-frame">
        <span
          ref={copy}
          className="book-spine-copy"
          data-title-lines="1"
          data-wrapped="false"
        >
          <span className="book-spine-title book-spine-title--single">
            {displayTitle.title}
          </span>
          {[
            { lineCount: 2, lines: twoTitleLines },
            { lineCount: 3, lines: threeTitleLines },
          ].map(({ lineCount, lines }) => (
            <span
              key={lineCount}
              className="book-spine-title book-spine-title--wrapped"
              data-title-layout={lines.length}
            >
              {lines.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </span>
          ))}
          <span className="book-spine-author">
            {formatAuthors(book.authors)}
          </span>
        </span>
      </span>
    </span>
  );
}

export function bookCoverAspectRatio(book: ShelfBookDto): number {
  const width = book.cover?.width;
  const height = book.cover?.height;

  return width !== null && width !== undefined && height
    ? width / height
    : DEFAULT_COVER_ASPECT_RATIO;
}

export function bookSpineWidthRem(book: ShelfBookDto): number {
  return bookSpineDimensions(book).widthRem;
}

export function bookHeightScale(book: ShelfBookDto): number {
  return bookSpineDimensions(book).heightScale;
}

export function bookSpineAreaUnits(book: ShelfBookDto): number {
  return bookSpineDimensions(book).areaUnits;
}

function bookSpineDimensions(book: ShelfBookDto): {
  areaUnits: number;
  heightScale: number;
  widthRem: number;
} {
  const stableFraction = deterministicBookFraction(book.id);
  const effectivePages = book.pages ?? 180 + stableFraction * 620;
  const pageInfluence = clamp((effectivePages - 80) / 920, 0, 1);
  const aspectRatio = clamp(bookCoverAspectRatio(book), 0.5, 0.85);
  const aspectInfluence = (0.85 - aspectRatio) / 0.35;
  const authorLength = formatAuthors(book.authors).replace(/\s+/g, " ").length;
  const primaryTitleLength = splitBookTitle(book.title).title.replace(
    /\s+/g,
    " ",
  ).length;
  const contentLength = primaryTitleLength + authorLength * 0.65;
  const contentDemand = clamp((contentLength - 42) / 90, 0, 1);
  const heightScale = clamp(
    0.72 +
      pageInfluence * 0.13 +
      aspectInfluence * 0.05 +
      stableFraction * 0.1 +
      contentDemand * 0.4,
    0.72,
    1,
  );
  const areaUnits =
    (2.05 + effectivePages * 0.006) * (1 + contentDemand * 0.35);

  return {
    areaUnits,
    heightScale,
    widthRem: clamp(
      areaUnits / heightScale,
      MIN_SPINE_WIDTH_REM,
      MAX_SPINE_WIDTH_REM,
    ),
  };
}

export function splitSpineTitle(title: string): [string, string | null] {
  const lines = splitSpineTitleLines(title, 2);
  return [lines[0] ?? "", lines[1] ?? null];
}

export function splitBookTitle(title: string): {
  title: string;
  subtitle: string | null;
} {
  const normalizedTitle = title.trim();
  const separatorIndex = normalizedTitle.indexOf(":");

  if (separatorIndex <= 0) {
    return { title: normalizedTitle, subtitle: null };
  }

  const primaryTitle = normalizedTitle.slice(0, separatorIndex).trim();
  const subtitle = normalizedTitle.slice(separatorIndex + 1).trim();

  return primaryTitle && subtitle
    ? { title: primaryTitle, subtitle }
    : { title: normalizedTitle, subtitle: null };
}

export function splitSpineTitleLines(
  title: string,
  requestedLineCount: number,
): string[] {
  const words = title.trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return [""];
  }

  const lineCount = clamp(
    Math.floor(requestedLineCount),
    1,
    words.length,
  );
  let bestLines: string[] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  function visit(start: number, linesRemaining: number, lines: string[]) {
    if (linesRemaining === 1) {
      const candidateLines = [...lines, words.slice(start).join(" ")];
      const lengths = candidateLines.map((line) => line.length);
      const longest = Math.max(...lengths);
      const score =
        longest * 10_000 + lengths.reduce((sum, length) => sum + length ** 2, 0);

      if (score < bestScore) {
        bestLines = candidateLines;
        bestScore = score;
      }
      return;
    }

    const lastEnd = words.length - linesRemaining + 1;
    for (let end = start + 1; end <= lastEnd; end += 1) {
      visit(end, linesRemaining - 1, [
        ...lines,
        words.slice(start, end).join(" "),
      ]);
    }
  }

  visit(0, lineCount, []);
  return bestLines ?? [words.join(" ")];
}

export function shouldWrapSpineTitle(
  singleLineFontSize: number,
  canWrap: boolean,
): boolean {
  return canWrap && singleLineFontSize < SPINE_TITLE_WRAP_THRESHOLD_PX;
}

function bookCardStyle(
  book: ShelfBookDto,
  presentation: BookPresentation,
  orientation: BookOrientation = "vertical",
): BookCardStyle {
  if (orientation === "horizontal") {
    return {
      "--book-width": `calc(var(--shelf-book-height) * ${bookHeightScale(book).toFixed(3)})`,
      "--book-height": `${bookSpineWidthRem(book).toFixed(3)}rem`,
      "--book-color": bookSpineColor(book.id),
    };
  }
  const width =
    presentation === "spine"
      ? `${bookSpineWidthRem(book).toFixed(3)}rem`
      : `calc(var(--book-height) * ${bookCoverAspectRatio(book)})`;

  return {
    "--book-width": width,
    "--book-height": `calc(var(--shelf-book-height) * ${bookHeightScale(book).toFixed(3)})`,
    "--book-color": bookSpineColor(book.id),
  };
}

function observeSpineResize(element: Element, callback: () => void): void {
  if (typeof ResizeObserver === "undefined") {
    return;
  }

  spineResizeObserver ??= new ResizeObserver((entries) => {
    for (const entry of entries) {
      spineResizeCallbacks.get(entry.target)?.();
    }
  });
  spineResizeCallbacks.set(element, callback);
  spineResizeObserver.observe(element);
}

function unobserveSpineResize(element: Element): void {
  spineResizeCallbacks.delete(element);
  spineResizeObserver?.unobserve(element);
}

function largestFittingSpineFontSize(copyElement: HTMLElement): number {
  let smallest = MIN_SPINE_FONT_SIZE_PX;
  let largest = MAX_SPINE_FONT_SIZE_PX;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = (smallest + largest) / 2;
    copyElement.style.fontSize = `${candidate}px`;

    const fits =
      copyElement.scrollWidth <= copyElement.clientWidth + 1 &&
      copyElement.scrollHeight <= copyElement.clientHeight + 1;

    if (fits) {
      smallest = candidate;
    } else {
      largest = candidate;
    }
  }

  return smallest;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function deterministicBookFraction(bookId: number): number {
  return ((Math.imul(bookId, 1_597_334_677) ^ 0x9e3779b9) >>> 0) / 2 ** 32;
}

function formatAuthors(authors: readonly string[]): string {
  return authors.length > 0 ? authors.join(", ") : "Unknown author";
}

function formatSeries(series: ShelfBookDto["series"][number]): string {
  return series.position === null
    ? series.name
    : `${series.name} #${ratingFormatter.format(series.position)}`;
}

function formatReadDates(
  firstReadDate: string | null,
  lastReadDate: string | null,
): string | null {
  if (firstReadDate && lastReadDate && firstReadDate !== lastReadDate) {
    return `First read ${formatDate(firstReadDate)} · Last read ${formatDate(lastReadDate)}`;
  }

  const readDate = lastReadDate ?? firstReadDate;
  return readDate ? `Read ${formatDate(readDate)}` : null;
}

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return dateFormatter.format(new Date(year!, month! - 1, day));
}
