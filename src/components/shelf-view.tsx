"use client";

import { ArrowLeft, RefreshCw, Settings, X } from "lucide-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  type BookPresentation,
  type BookPresentationPreferences,
  loadBookPresentationPreferences,
  saveBookPresentationPreferences,
} from "../client/book-presentations";
import {
  loadShelfSnapshot,
  refreshShelfSnapshot,
  ShelfLoadError,
  type ShelfLoadPhase,
  type ShelfSnapshotDto,
} from "../client/shelf-api";
import {
  DEFAULT_SHELF_THEME,
  SHELF_THEMES,
  SHELF_THEME_COOKIE_MAX_AGE,
  SHELF_THEME_COOKIE_NAME,
  type ShelfThemeName,
} from "../shared/shelf-themes";
import { BookCard } from "./book-card";

type ShelfName = "read" | "wantToRead";
const SHELF_THEME_NAMES = Object.keys(SHELF_THEMES) as ShelfThemeName[];

interface ShelfViewProps {
  username: string;
  theme?: ShelfThemeName;
}

export function ShelfView({
  username,
  theme = DEFAULT_SHELF_THEME,
}: ShelfViewProps) {
  const [snapshot, setSnapshot] = useState<ShelfSnapshotDto | null>(null);
  const [phase, setPhase] = useState<ShelfLoadPhase>("checking");
  const [error, setError] = useState<string | null>(null);
  const [selectedShelf, setSelectedShelf] = useState<ShelfName>("read");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [bookPresentations, setBookPresentations] =
    useState<BookPresentationPreferences>({});
  const [activeTheme, setActiveTheme] = useState<ShelfThemeName>(theme);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const readTab = useRef<HTMLButtonElement>(null);
  const wantToReadTab = useRef<HTMLButtonElement>(null);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const settingsDialog = useRef<HTMLElement>(null);
  const settingsClose = useRef<HTMLButtonElement>(null);
  const refreshController = useRef<AbortController | null>(null);
  const themeConfig = SHELF_THEMES[activeTheme];
  const shelfOverlays = themeConfig.shelfOverlays?.join(" ");

  useEffect(() => {
    setActiveTheme(theme);
  }, [theme]);

  useEffect(() => {
    const storage = getBrowserStorage();

    if (snapshot && storage) {
      saveBookPresentationPreferences(
        storage,
        snapshot.profile.username,
        bookPresentations,
      );
    }
  }, [bookPresentations, snapshot?.profile.username]);

  useEffect(() => {
    if (!isSettingsOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    settingsClose.current?.focus();

    function handleSettingsKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setIsSettingsOpen(false);
        return;
      }

      if (event.key !== "Tab" || !settingsDialog.current) {
        return;
      }

      const focusable = Array.from(
        settingsDialog.current.querySelectorAll<HTMLElement>(
          'input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
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

    document.addEventListener("keydown", handleSettingsKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleSettingsKeyDown);
      settingsTrigger.current?.focus();
    };
  }, [isSettingsOpen]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setSnapshot(null);
    setError(null);
    setSelectedShelf("read");
    setIsRefreshing(false);
    setRefreshMessage(null);
    setRefreshError(null);
    setBookPresentations({});
    refreshController.current?.abort();
    refreshController.current = null;

    loadShelfSnapshot(username, {
      signal: controller.signal,
      onPhase: (nextPhase) => {
        if (active) {
          setPhase(nextPhase);
        }
      },
    })
      .then((nextSnapshot) => {
        if (active) {
          const storage = getBrowserStorage();
          setBookPresentations(
            storage
              ? loadBookPresentationPreferences(
                  storage,
                  nextSnapshot.profile.username,
                )
              : {},
          );
          setSnapshot(nextSnapshot);
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(
            caught instanceof ShelfLoadError
              ? caught.message
              : "The shelf service could not be reached.",
          );
        }
      });

    return () => {
      active = false;
      controller.abort();
      refreshController.current?.abort();
      refreshController.current = null;
    };
  }, [username]);

  async function refreshShelf() {
    if (isRefreshing || refreshController.current) {
      return;
    }

    const controller = new AbortController();
    refreshController.current = controller;
    setIsRefreshing(true);
    setRefreshMessage(null);
    setRefreshError(null);

    try {
      const nextSnapshot = await refreshShelfSnapshot(username, {
        signal: controller.signal,
      });

      if (refreshController.current === controller) {
        setSnapshot(nextSnapshot);
        setRefreshMessage("Shelf refreshed. The latest books are now shown.");
      }
    } catch (caught: unknown) {
      if (refreshController.current === controller && !controller.signal.aborted) {
        const message =
          caught instanceof ShelfLoadError
            ? caught.message
            : "The shelf service could not be reached.";
        setRefreshError(
          `Refresh failed. ${message} The last synchronized shelf is still shown.`,
        );
      }
    } finally {
      if (refreshController.current === controller) {
        refreshController.current = null;
        setIsRefreshing(false);
      }
    }
  }

  function selectShelf(shelf: ShelfName, moveFocus = false) {
    setSelectedShelf(shelf);

    if (moveFocus) {
      const target = shelf === "read" ? readTab.current : wantToReadTab.current;
      target?.focus();
    }
  }

  function closeSettingsFromBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      setIsSettingsOpen(false);
    }
  }

  function selectTheme(themeName: ShelfThemeName) {
    setActiveTheme(themeName);

    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${SHELF_THEME_COOKIE_NAME}=${themeName}; Path=/; Max-Age=${SHELF_THEME_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
  }

  function selectBookPresentation(
    bookId: number,
    presentation: BookPresentation,
  ) {
    if (!snapshot) {
      return;
    }

    setBookPresentations((current) => {
      return { ...current, [bookId]: presentation };
    });
  }

  function handleTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    shelf: ShelfName,
  ) {
    let nextShelf: ShelfName | null = null;

    switch (event.key) {
      case "ArrowLeft":
      case "ArrowUp":
        nextShelf = shelf === "read" ? "wantToRead" : "read";
        break;
      case "ArrowRight":
      case "ArrowDown":
        nextShelf = shelf === "read" ? "wantToRead" : "read";
        break;
      case "Home":
        nextShelf = "read";
        break;
      case "End":
        nextShelf = "wantToRead";
        break;
    }

    if (nextShelf) {
      event.preventDefault();
      selectShelf(nextShelf, true);
    }
  }

  if (error) {
    return (
      <section
        className="shelf-state shelf-state--immersive"
        data-shelf-theme={theme}
        style={themeConfig.properties}
        aria-labelledby="shelf-error-heading"
      >
        <p className="eyebrow">Shelf unavailable</p>
        <h1 id="shelf-error-heading">Unable to load this shelf</h1>
        <p role="alert">{error}</p>
        <a href="/">Try another profile</a>
      </section>
    );
  }

  if (!snapshot) {
    return (
      <section
        className="shelf-state shelf-state--immersive"
        data-shelf-theme={theme}
        style={themeConfig.properties}
        aria-labelledby="shelf-loading-heading"
      >
        <p className="eyebrow">Public Hardcover shelf</p>
        <h1 id="shelf-loading-heading">Loading @{username}</h1>
        {phase === "synchronizing" ? (
          <p role="status">
            No cached shelf was found. Synchronizing every public book…
          </p>
        ) : phase === "loading" ? (
          <p role="status">Loading the synchronized shelf…</p>
        ) : (
          <p role="status">Checking for a cached shelf…</p>
        )}
      </section>
    );
  }

  const readTabLabel = `Read (${snapshot.shelves.read.length})`;
  const wantToReadTabLabel = `Want to Read (${snapshot.shelves.wantToRead.length})`;

  return (
    <article
      className="shelf-page"
      data-shelf-theme={activeTheme}
      data-shelf-overlays={shelfOverlays}
      style={themeConfig.properties}
    >
      <h1 className="visually-hidden">
        {snapshot.profile.displayName || `@${snapshot.profile.username}`}&apos;s
        bookshelf
      </h1>

      <header className="shelf-toolbar">
        <a
          className="shelf-profile-control"
          href="/"
          aria-label="Choose another profile"
        >
          <ArrowLeft className="shelf-tool-icon" aria-hidden="true" />
          <span className="shelf-profile-copy">
            <span>
              {snapshot.profile.displayName || `@${snapshot.profile.username}`}
            </span>
            {snapshot.profile.displayName ? (
              <small>@{snapshot.profile.username}</small>
            ) : null}
          </span>
        </a>

        <div className="shelf-tabs" role="tablist" aria-label="Book shelves">
          <button
            ref={readTab}
            id="read-tab"
            type="button"
            role="tab"
            aria-label={readTabLabel}
            aria-selected={selectedShelf === "read"}
            aria-controls="read-panel"
            tabIndex={selectedShelf === "read" ? 0 : -1}
            onClick={() => selectShelf("read")}
            onKeyDown={(event) => handleTabKeyDown(event, "read")}
          >
            Read <span>{snapshot.shelves.read.length}</span>
          </button>
          <button
            ref={wantToReadTab}
            id="want-to-read-tab"
            type="button"
            role="tab"
            aria-label={wantToReadTabLabel}
            aria-selected={selectedShelf === "wantToRead"}
            aria-controls="want-to-read-panel"
            tabIndex={selectedShelf === "wantToRead" ? 0 : -1}
            onClick={() => selectShelf("wantToRead")}
            onKeyDown={(event) => handleTabKeyDown(event, "wantToRead")}
          >
            Want to read <span>{snapshot.shelves.wantToRead.length}</span>
          </button>
        </div>

        <div className="shelf-toolbar-actions">
          <button
            className="shelf-action-button refresh-button"
            type="button"
            aria-label={isRefreshing ? "Refreshing…" : "Refresh shelf"}
            title="Refresh shelf"
            disabled={isRefreshing}
            onClick={refreshShelf}
          >
            <RefreshCw aria-hidden="true" />
          </button>
          <button
            ref={settingsTrigger}
            className="shelf-action-button settings-button"
            type="button"
            aria-label="Shelf settings"
            aria-haspopup="dialog"
            title="Shelf settings"
            onClick={() => setIsSettingsOpen(true)}
          >
            <Settings aria-hidden="true" />
          </button>
        </div>
      </header>

      {isSettingsOpen ? (
        <div
          className="settings-dialog-backdrop"
          role="presentation"
          onMouseDown={closeSettingsFromBackdrop}
        >
          <section
            ref={settingsDialog}
            className="settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="shelf-settings-title"
          >
            <button
              ref={settingsClose}
              className="settings-dialog-close"
              type="button"
              aria-label="Close shelf settings"
              onClick={() => setIsSettingsOpen(false)}
            >
              <X aria-hidden="true" />
            </button>
            <p className="settings-dialog-kicker">Appearance</p>
            <h2 id="shelf-settings-title">Shelf settings</h2>
            <fieldset className="theme-fieldset">
              <legend>Theme</legend>
              <div className="theme-options">
                {SHELF_THEME_NAMES.map((themeName) => {
                  const option = SHELF_THEMES[themeName];
                  return (
                    <label
                      key={themeName}
                      className="theme-option"
                      data-selected={activeTheme === themeName}
                    >
                      <input
                        type="radio"
                        name="shelf-theme"
                        value={themeName}
                        checked={activeTheme === themeName}
                        onChange={() => selectTheme(themeName)}
                      />
                      <span
                        className="theme-swatch"
                        style={option.properties}
                        aria-hidden="true"
                      >
                        <span />
                      </span>
                      <span className="theme-option-copy">
                        <strong>{option.label}</strong>
                        <small>{option.description}</small>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <button
              className="settings-done-button"
              type="button"
              onClick={() => setIsSettingsOpen(false)}
            >
              Done
            </button>
          </section>
        </div>
      ) : null}

      <p className="visually-hidden">
        Last synchronized{" "}
        <time dateTime={snapshot.profile.lastSyncedAt}>
          {snapshot.profile.lastSyncedAt}
        </time>
      </p>

      {isRefreshing ? (
        <p className="refresh-notice" role="status">
          Refreshing the shelf. The current books remain available.
        </p>
      ) : refreshError ? (
        <p className="refresh-notice refresh-error" role="alert">
          {refreshError}
        </p>
      ) : refreshMessage ? (
        <p className="refresh-notice" role="status">
          {refreshMessage}
        </p>
      ) : null}

      <ShelfPanel
        id="read-panel"
        labelledBy="read-tab"
        shelfLabel="Read"
        books={snapshot.shelves.read}
        bookPresentations={bookPresentations}
        onBookPresentationChange={selectBookPresentation}
        hidden={selectedShelf !== "read"}
      />
      <ShelfPanel
        id="want-to-read-panel"
        labelledBy="want-to-read-tab"
        shelfLabel="Want to Read"
        books={snapshot.shelves.wantToRead}
        bookPresentations={bookPresentations}
        onBookPresentationChange={selectBookPresentation}
        hidden={selectedShelf !== "wantToRead"}
      />
    </article>
  );
}

interface ShelfPanelProps {
  id: string;
  labelledBy: string;
  shelfLabel: string;
  books: ShelfSnapshotDto["shelves"]["read"];
  bookPresentations: BookPresentationPreferences;
  onBookPresentationChange: (
    bookId: number,
    presentation: BookPresentation,
  ) => void;
  hidden: boolean;
}

function ShelfPanel({
  id,
  labelledBy,
  shelfLabel,
  books,
  bookPresentations,
  onBookPresentationChange,
  hidden,
}: ShelfPanelProps) {
  return (
    <section
      id={id}
      role="tabpanel"
      aria-labelledby={labelledBy}
      tabIndex={0}
      hidden={hidden}
      className="shelf-panel"
    >
      {books.length > 0 ? (
        <ul className="bookshelf" aria-label={`${shelfLabel} bookshelf`}>
          {books.map((book, index) => (
            <BookCard
              key={book.id}
              book={book}
              eager={index < 8}
              presentation={bookPresentations[book.id] ?? "cover"}
              onPresentationChange={(presentation) =>
                onBookPresentationChange(book.id, presentation)
              }
            />
          ))}
        </ul>
      ) : (
        <p className="shelf-empty">No {shelfLabel} books are on this shelf.</p>
      )}
    </section>
  );
}

function getBrowserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
