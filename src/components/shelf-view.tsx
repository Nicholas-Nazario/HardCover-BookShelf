"use client";

import { ArrowLeft, Pencil, Redo2, RefreshCw, Settings, Undo2, X } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type Announcements,
} from "@dnd-kit/core";
import {
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { type BookPresentation } from "../client/book-presentations";
import {
  addBookToHorizontalStack,
  createShelfLayout,
  createHorizontalBookStack,
  loadOrCreateShelfLayout,
  reconcileShelfLayout,
  removeBookFromHorizontalStack,
  removeBookFromHorizontalStackToRowEnd,
  saveShelfLayout,
  type ShelfBookIds,
  type BookShelfItem,
  type HorizontalBookStack as HorizontalBookStackModel,
  type ShelfLayout,
  type ShelfLayoutShelfName,
  type ShelfSceneLayout,
  moveShelfItem,
  updateBookPresentation,
  updateBookOrientation,
  unstackHorizontalBookStack,
  type BookOrientation,
} from "../client/shelf-layout";
import {
  loadShelfSnapshot,
  refreshShelfSnapshot,
  ShelfLoadError,
  type ShelfBookDto,
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
import { HorizontalBookStack } from "./horizontal-book-stack";

type ShelfName = "read" | "wantToRead";
const SHELF_THEME_NAMES = Object.keys(SHELF_THEMES) as ShelfThemeName[];
const MAX_LAYOUT_HISTORY_ENTRIES = 50;

interface ShelfLayoutHistory {
  current: ShelfLayout | null;
  past: ShelfLayout[];
  future: ShelfLayout[];
}

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
  const [layoutHistory, setLayoutHistory] = useState<ShelfLayoutHistory>({
    current: null,
    past: [],
    future: [],
  });
  const [activeTheme, setActiveTheme] = useState<ShelfThemeName>(theme);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedBookId, setSelectedBookId] = useState<number | null>(null);
  const [selectedBookIds, setSelectedBookIds] = useState<number[]>([]);
  const readTab = useRef<HTMLButtonElement>(null);
  const wantToReadTab = useRef<HTMLButtonElement>(null);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const settingsDialog = useRef<HTMLElement>(null);
  const settingsClose = useRef<HTMLButtonElement>(null);
  const refreshController = useRef<AbortController | null>(null);
  const themeConfig = SHELF_THEMES[activeTheme];
  const shelfOverlays = themeConfig.shelfOverlays?.join(" ");
  const shelfLayout = layoutHistory.current;
  const canUndoLayout = layoutHistory.past.length > 0;
  const canRedoLayout = layoutHistory.future.length > 0;

  useEffect(() => {
    setActiveTheme(theme);
  }, [theme]);

  useEffect(() => {
    const storage = getBrowserStorage();

    if (snapshot && shelfLayout && storage) {
      saveShelfLayout(storage, snapshot.profile.username, shelfLayout);
    }
  }, [shelfLayout, snapshot?.profile.username]);

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
    if (!isEditMode) {
      return;
    }

    function handleEditHistoryKeyDown(event: globalThis.KeyboardEvent) {
      const key = event.key.toLowerCase();
      if (
        !(event.metaKey || event.ctrlKey) ||
        (key !== "z" && key !== "y")
      ) {
        return;
      }

      event.preventDefault();
      setLayoutHistory((current) =>
        event.shiftKey || key === "y"
          ? redoLayoutHistory(current)
          : undoLayoutHistory(current),
      );
    }

    window.addEventListener("keydown", handleEditHistoryKeyDown);
    return () => window.removeEventListener("keydown", handleEditHistoryKeyDown);
  }, [isEditMode]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setSnapshot(null);
    setError(null);
    setSelectedShelf("read");
    setIsRefreshing(false);
    setRefreshMessage(null);
    setRefreshError(null);
    setLayoutHistory({ current: null, past: [], future: [] });
    setIsEditMode(false);
    setSelectedBookId(null);
    setSelectedBookIds([]);
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
          const bookIds = snapshotBookIds(nextSnapshot);
          setLayoutHistory({
            current: storage
              ? loadOrCreateShelfLayout(
                  storage,
                  nextSnapshot.profile.username,
                  bookIds,
                )
              : createShelfLayout(bookIds),
            past: [],
            future: [],
          });
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
        const storage = getBrowserStorage();
        const bookIds = snapshotBookIds(nextSnapshot);
        setLayoutHistory((current) =>
          reconcileLayoutHistory(
            current,
            bookIds,
            storage
              ? loadOrCreateShelfLayout(
                  storage,
                  nextSnapshot.profile.username,
                  bookIds,
                )
              : createShelfLayout(bookIds),
          ),
        );
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
    setSelectedBookId(null);
    setSelectedBookIds([]);

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

    commitLayoutChange((current) =>
      updateBookPresentation(current, bookId, presentation),
    );
  }

  function selectBookOrientation(bookId: number, orientation: BookOrientation) {
    commitLayoutChange((current) => updateBookOrientation(current, bookId, orientation));
  }

  function selectBookForEditing(bookId: number) {
    setSelectedBookId(bookId);
    setSelectedBookIds((current) =>
      current.includes(bookId)
        ? current.filter((id) => id !== bookId)
        : [...current, bookId],
    );
  }

  function stackSelectedBooks() {
    if (selectedBookIds.length < 2) return;
    commitLayoutChange((current) =>
      createHorizontalBookStack(
        current,
        selectedShelf,
        selectedBookIds.map((id) => `book:${id}`),
      ),
    );
    setSelectedBookId(null);
    setSelectedBookIds([]);
  }

  function unstackBooks(shelf: ShelfName, stackId: string) {
    commitLayoutChange((current) =>
      unstackHorizontalBookStack(current, shelf, stackId),
    );
    setSelectedBookId(null);
    setSelectedBookIds([]);
  }

  function commitLayoutChange(
    change: (current: ShelfLayout) => ShelfLayout,
  ) {
    setLayoutHistory((current) => {
      if (!current.current) {
        return current;
      }

      const nextLayout = change(current.current);
      if (nextLayout === current.current) {
        return current;
      }

      return {
        current: nextLayout,
        past: [...current.past, current.current].slice(
          -MAX_LAYOUT_HISTORY_ENTRIES,
        ),
        future: [],
      };
    });
  }

  function undoLayoutChange() {
    setLayoutHistory(undoLayoutHistory);
  }

  function redoLayoutChange() {
    setLayoutHistory(redoLayoutHistory);
  }

  function toggleEditMode() {
    setIsEditMode((editing) => !editing);
    setSelectedBookId(null);
    setSelectedBookIds([]);
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
  const selectedBook = [...snapshot.shelves.read, ...snapshot.shelves.wantToRead].find(
    (book) => book.id === selectedBookId,
  );
  const selectedBookPresentation = selectedBook
    ? presentationForBook(shelfLayout, selectedBook.id)
    : "cover";
  const selectedBookOrientation = selectedBook
    ? orientationForBook(shelfLayout, selectedBook.id)
    : "vertical";

  return (
    <article
      className="shelf-page"
      data-shelf-theme={activeTheme}
      data-shelf-overlays={shelfOverlays}
      data-edit-mode={isEditMode || undefined}
      style={themeConfig.properties}
    >
      <h1 className="visually-hidden">
        {snapshot.profile.displayName || `@${snapshot.profile.username}`}&apos;s
        bookshelf
      </h1>

      <header
        className={`shelf-toolbar${isEditMode ? " shelf-toolbar--editing" : ""}`}
      >
        {isEditMode ? (
          <>
            <div className="shelf-edit-toolbar-copy">
              <span>Editing shelf</span>
              <small>
                {selectedBookIds.length > 1
                  ? `${selectedBookIds.length} books selected`
                  : selectedBook
                  ? `Appearance for ${selectedBook.title}`
                  : "Select a book"}
              </small>
            </div>
            <div className="shelf-edit-toolbar-controls">
              <div className="shelf-edit-history-controls" aria-label="Layout history">
                <button
                  className="shelf-action-button"
                  type="button"
                  aria-label="Undo layout change"
                  title="Undo (⌘/Ctrl+Z)"
                  disabled={!canUndoLayout}
                  onClick={undoLayoutChange}
                >
                  <Undo2 aria-hidden="true" />
                </button>
                <button
                  className="shelf-action-button"
                  type="button"
                  aria-label="Redo layout change"
                  title="Redo (⌘/Ctrl+Shift+Z or Ctrl+Y)"
                  disabled={!canRedoLayout}
                  onClick={redoLayoutChange}
                >
                  <Redo2 aria-hidden="true" />
                </button>
              </div>
              {selectedBook ? (
                <fieldset>
                  <legend className="visually-hidden">
                    Appearance for {selectedBook.title}
                  </legend>
                  <div className="book-presentation-options">
                    {(["cover", "spine"] as const).map((presentation) => (
                      <label
                        key={presentation}
                        data-selected={
                          selectedBookPresentation === presentation
                        }
                      >
                        <input
                          type="radio"
                          name="selected-book-presentation"
                          value={presentation}
                          checked={
                            selectedBookPresentation === presentation
                          }
                          onChange={() =>
                            selectBookPresentation(selectedBook.id, presentation)
                          }
                        />
                        <span>
                          {presentation === "cover" ? "Cover" : "Spine"}
                        </span>
                      </label>
                    ))}
                  </div>
                  <div className="book-presentation-options">
                    {(["vertical", "horizontal"] as const).map((orientation) => (
                      <label key={orientation} data-selected={orientationForBook(shelfLayout, selectedBook.id) === orientation}>
                        <input type="radio" name="selected-book-orientation" value={orientation} checked={orientationForBook(shelfLayout, selectedBook.id) === orientation} onChange={() => selectBookOrientation(selectedBook.id, orientation)} />
                        <span>{orientation === "vertical" ? "Stand" : "Lay flat"}</span>
                      </label>
                    ))}
                  </div>
                  {selectedBookIds.length > 1 ? (
                    <button
                      className="shelf-stack-button"
                      type="button"
                      onClick={stackSelectedBooks}
                    >
                      Stack these books
                    </button>
                  ) : null}
                </fieldset>
              ) : (
                <span className="shelf-edit-toolbar-hint">
                  Choose a book below
                </span>
              )}
            </div>
            <div className="shelf-toolbar-actions">
              <button
                className="shelf-action-button shelf-edit-mode-button"
                type="button"
                onClick={toggleEditMode}
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
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
          <button
            className="shelf-action-button shelf-edit-mode-button"
            type="button"
            aria-label="Edit"
            title="Edit shelf appearance"
            onClick={toggleEditMode}
          >
            <Pencil aria-hidden="true" />
          </button>
        </div>
          </>
        )}
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
        layout={shelfLayout?.shelves.read ?? null}
        isEditing={isEditMode}
        selectedBookId={selectedBookId}
        selectedBookIds={selectedBookIds}
        onSelectBookForEditing={selectBookForEditing}
        onDropItem={(activeItemId, overItemId) =>
          commitLayoutChange((current) =>
            applyShelfDragOperation(current, "read", activeItemId, overItemId),
          )
        }
        onUnstack={(stackId) => unstackBooks("read", stackId)}
        hidden={selectedShelf !== "read"}
      />
      <ShelfPanel
        id="want-to-read-panel"
        labelledBy="want-to-read-tab"
        shelfLabel="Want to Read"
        books={snapshot.shelves.wantToRead}
        layout={shelfLayout?.shelves.wantToRead ?? null}
        isEditing={isEditMode}
        selectedBookId={selectedBookId}
        selectedBookIds={selectedBookIds}
        onSelectBookForEditing={selectBookForEditing}
        onDropItem={(activeItemId, overItemId) =>
          commitLayoutChange((current) =>
            applyShelfDragOperation(
              current,
              "wantToRead",
              activeItemId,
              overItemId,
            ),
          )
        }
        onUnstack={(stackId) => unstackBooks("wantToRead", stackId)}
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
  layout: ShelfSceneLayout | null;
  isEditing: boolean;
  selectedBookId: number | null;
  selectedBookIds: number[];
  onSelectBookForEditing: (bookId: number) => void;
  onDropItem: (activeItemId: string, overItemId: string) => void;
  onUnstack: (stackId: string) => void;
  hidden: boolean;
}

function ShelfPanel({
  id,
  labelledBy,
  shelfLabel,
  books,
  layout,
  isEditing,
  selectedBookId,
  selectedBookIds,
  onSelectBookForEditing,
  onDropItem,
  onUnstack,
  hidden,
}: ShelfPanelProps) {
  const [previewLayout, setPreviewLayout] = useState<ShelfSceneLayout | null>(null);
  const [overItemId, setOverItemId] = useState<string | null>(null);
  const [activeOverlay, setActiveOverlay] = useState<ShelfDragOverlay | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );
  const displayedEntries = shelfEntriesInLayoutOrder(books, previewLayout ?? layout);
  const announcements = shelfDragAnnouncements(books, layout);
  const dropPreviewMember = overItemId
    ? parseStackMemberDragId(overItemId)
    : null;
  const endRowId = layout?.rows.at(-1)?.id ?? null;

  function updatePreview(activeItemId: string, overItemId: string) {
    if (!layout) return;
    const preview = createShelfDragPreview(
      { version: 1, shelves: { read: layout, wantToRead: layout } },
      "read",
      activeItemId,
      overItemId,
    ).shelves.read;
    setPreviewLayout(preview);
    setOverItemId(preview === layout ? null : overItemId);
  }

  function handleDragStart(event: DragStartEvent) {
    const nextActiveItemId = String(event.active.id);
    setActiveOverlay(
      findShelfDragOverlay(books, layout, nextActiveItemId),
    );
    setOverItemId(null);
    setPreviewLayout(layout);
  }

  function handleDragOver(event: DragOverEvent) {
    if (event.over) updatePreview(String(event.active.id), String(event.over.id));
  }

  function finishDrag(event: DragEndEvent) {
    if (event.over) onDropItem(String(event.active.id), String(event.over.id));
    clearDragState();
  }

  function clearDragState() {
    setOverItemId(null);
    setActiveOverlay(null);
    setPreviewLayout(null);
  }

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
        isEditing ? <DndContext
          sensors={sensors}
          accessibility={{ announcements }}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={finishDrag}
          onDragCancel={clearDragState}
        >
        <ul className="bookshelf" aria-label={`${shelfLabel} bookshelf`}>
          {displayedEntries.map((entry, index) =>
            entry.kind === "book" ? (
              <DraggableBookCard
                key={entry.item.id}
                itemId={entry.item.id}
                book={entry.book}
                eager={index < 8}
                presentation={entry.item.presentation}
                orientation={entry.item.orientation}
                isEditing={isEditing}
                isSelectedForEditing={selectedBookIds.includes(entry.book.id) || selectedBookId === entry.book.id}
                onSelectForEditing={() => onSelectBookForEditing(entry.book.id)}
                isDropPreview={overItemId === entry.item.id}
              />
            ) : (
              <DraggableHorizontalBookStack
                key={entry.stack.id}
                entry={entry}
                eager={index < 8}
                isEditing
                selectedBookIds={selectedBookIds}
                onSelectBookForEditing={onSelectBookForEditing}
                onUnstack={() => onUnstack(entry.stack.id)}
                isDropPreview={overItemId === `stack:${entry.stack.id}`}
                dropPreviewMemberItemId={
                  dropPreviewMember?.stackId === entry.stack.id
                    ? dropPreviewMember.bookItemId
                    : null
                }
              />
            ),
          )}
          {endRowId ? (
            <ShelfRowEndDropTarget
              rowId={endRowId}
              isDropPreview={overItemId === shelfRowEndDragId(endRowId)}
            />
          ) : null}
        </ul>
        <DragOverlay>
          {activeOverlay ? (
            <ul className="shelf-drag-overlay">
              {activeOverlay.kind === "book" ? (
                <BookCard
                  book={activeOverlay.book}
                  presentation={activeOverlay.item.presentation}
                  orientation={activeOverlay.item.orientation}
                  isEditing
                />
              ) : (
                <HorizontalBookStack
                  stack={activeOverlay.stack}
                  books={activeOverlay.books}
                />
              )}
            </ul>
          ) : null}
        </DragOverlay>
        </DndContext> : <ul className="bookshelf" aria-label={`${shelfLabel} bookshelf`}>
          {displayedEntries.map((entry, index) =>
            entry.kind === "book" ? (
              <DraggableBookCard
                key={entry.item.id}
                itemId={entry.item.id}
                book={entry.book}
                eager={index < 8}
                presentation={entry.item.presentation}
                orientation={entry.item.orientation}
                isEditing={false}
                isSelectedForEditing={false}
                onSelectForEditing={() => onSelectBookForEditing(entry.book.id)}
                isDropPreview={false}
              />
            ) : (
              <HorizontalBookStack
                key={entry.stack.id}
                stack={entry.stack}
                books={entry.books}
                eager={index < 8}
              />
            ),
          )}
        </ul>
      ) : (
        <p className="shelf-empty">No {shelfLabel} books are on this shelf.</p>
      )}
    </section>
  );
}

interface DraggableBookCardProps {
  itemId: string;
  book: ShelfSnapshotDto["shelves"]["read"][number];
  eager: boolean;
  presentation: BookPresentation;
  orientation: BookOrientation;
  isEditing: boolean;
  isSelectedForEditing: boolean;
  onSelectForEditing: () => void;
  isDropPreview: boolean;
}

function DraggableBookCard({ itemId, isEditing, isDropPreview, ...props }: DraggableBookCardProps) {
  const draggable = useDraggable({ id: itemId, disabled: !isEditing });
  const droppable = useDroppable({ id: itemId, disabled: !isEditing });

  return (
    <BookCard
      {...props}
      isEditing={isEditing}
      drag={{
        attributes: draggable.attributes,
        listeners: draggable.listeners,
        setNodeRef: (node) => {
          draggable.setNodeRef(node);
          droppable.setNodeRef(node);
        },
        isDragging: draggable.isDragging,
        isDropPreview,
      }}
    />
  );
}

function ShelfRowEndDropTarget({
  rowId,
  isDropPreview,
}: {
  rowId: string;
  isDropPreview: boolean;
}) {
  const droppable = useDroppable({ id: shelfRowEndDragId(rowId) });
  return (
    <li
      className="shelf-row-end-drop-target"
      data-drop-preview={isDropPreview || undefined}
      ref={droppable.setNodeRef}
      aria-label="End of shelf row"
    />
  );
}

interface DraggableHorizontalBookStackProps {
  entry: Extract<RenderableShelfEntry, { kind: "stack" }>;
  eager: boolean;
  isEditing: boolean;
  selectedBookIds: readonly number[];
  onSelectBookForEditing: (bookId: number) => void;
  onUnstack: () => void;
  isDropPreview: boolean;
  dropPreviewMemberItemId: string | null;
}

function DraggableHorizontalBookStack({
  entry,
  eager,
  isEditing,
  selectedBookIds,
  onSelectBookForEditing,
  onUnstack,
  isDropPreview,
  dropPreviewMemberItemId,
}: DraggableHorizontalBookStackProps) {
  const itemId = `stack:${entry.stack.id}`;
  const draggable = useDraggable({ id: itemId, disabled: !isEditing });
  const droppable = useDroppable({ id: itemId, disabled: !isEditing });

  return (
    <HorizontalBookStack
      stack={entry.stack}
      books={entry.books}
      eager={eager}
      isEditing={isEditing}
      selectedBookIds={selectedBookIds}
      onSelectBookForEditing={onSelectBookForEditing}
      onUnstack={onUnstack}
      dropPreviewMemberItemId={dropPreviewMemberItemId}
      drag={{
        attributes: draggable.attributes,
        listeners: draggable.listeners,
        setNodeRef: (node) => {
          draggable.setNodeRef(node);
          droppable.setNodeRef(node);
        },
        isDragging: draggable.isDragging,
        isDropPreview,
      }}
    />
  );
}

interface StackMemberDragTarget {
  stackId: string;
  bookItemId: string;
}

export function applyShelfDragOperation(
  layout: ShelfLayout,
  shelf: ShelfLayoutShelfName,
  activeItemId: string,
  overItemId: string,
): ShelfLayout {
  const activeMember = parseStackMemberDragId(activeItemId);
  const overMember = parseStackMemberDragId(overItemId);
  const overRowEnd = parseShelfRowEndDragId(overItemId);
  const overStackId =
    overMember?.stackId ?? stackIdFromPlacementId(overItemId);

  if (activeMember) {
    if (overStackId) return layout;
    if (overRowEnd) {
      return removeBookFromHorizontalStackToRowEnd(
        layout,
        shelf,
        activeMember.stackId,
        activeMember.bookItemId,
        overRowEnd,
      );
    }
    return removeBookFromHorizontalStack(
      layout,
      shelf,
      activeMember.stackId,
      activeMember.bookItemId,
      overItemId,
    );
  }

  if (activeItemId.startsWith("stack:")) {
    if (overRowEnd) return layout;
    return moveShelfItem(
      layout,
      shelf,
      activeItemId,
      overMember ? `stack:${overMember.stackId}` : overItemId,
    );
  }

  if (overStackId) {
    const stack = layout.shelves[shelf].stacks[overStackId];
    const memberIndex = overMember
      ? stack?.bookItemIds.indexOf(overMember.bookItemId)
      : undefined;
    return addBookToHorizontalStack(
      layout,
      shelf,
      overStackId,
      activeItemId,
      memberIndex !== undefined && memberIndex >= 0
        ? memberIndex
        : undefined,
    );
  }

  if (overRowEnd) return layout;

  return moveShelfItem(layout, shelf, activeItemId, overItemId);
}

export function createShelfDragPreview(
  layout: ShelfLayout,
  shelf: ShelfLayoutShelfName,
  activeItemId: string,
  overItemId: string,
): ShelfLayout {
  const preview = applyShelfDragOperation(
    layout,
    shelf,
    activeItemId,
    overItemId,
  );
  const activeMember = parseStackMemberDragId(activeItemId);
  if (!activeMember || preview === layout) return preview;

  const sourceScene = layout.shelves[shelf];
  const sourceStack = sourceScene.stacks[activeMember.stackId];
  if (!sourceStack || sourceStack.bookItemIds.length !== 2) return preview;

  const remainingBookItemId = sourceStack.bookItemIds.find(
    (bookItemId) => bookItemId !== activeMember.bookItemId,
  );
  const previewScene = preview.shelves[shelf];
  if (!remainingBookItemId || previewScene.stacks[sourceStack.id]) {
    return preview;
  }

  const stackPlacement = `stack:${sourceStack.id}`;
  const rows = previewScene.rows.map((row) => ({
    ...row,
    items: row.items.map((itemId) =>
      itemId === remainingBookItemId ? stackPlacement : itemId,
    ),
  }));

  return {
    ...preview,
    shelves: {
      ...preview.shelves,
      [shelf]: {
        ...previewScene,
        rows,
        stacks: {
          ...previewScene.stacks,
          [sourceStack.id]: {
            ...sourceStack,
            bookItemIds: [remainingBookItemId],
          },
        },
      },
    },
  };
}

function parseStackMemberDragId(
  dragId: string,
): StackMemberDragTarget | null {
  const match = /^stack-member:([^:]+):(book:\d+)$/.exec(dragId);
  return match
    ? { stackId: match[1]!, bookItemId: match[2]! }
    : null;
}

function stackIdFromPlacementId(placementId: string): string | null {
  return placementId.startsWith("stack:")
    ? placementId.slice("stack:".length)
    : null;
}

function shelfRowEndDragId(rowId: string): string {
  return `shelf-row-end:${encodeURIComponent(rowId)}`;
}

function parseShelfRowEndDragId(dragId: string): string | null {
  if (!dragId.startsWith("shelf-row-end:")) return null;
  try {
    return decodeURIComponent(dragId.slice("shelf-row-end:".length));
  } catch {
    return null;
  }
}

type ShelfDragOverlay = RenderableShelfEntry;

function findShelfDragOverlay(
  books: ShelfSnapshotDto["shelves"]["read"],
  layout: ShelfSceneLayout | null,
  activeItemId: string,
): ShelfDragOverlay | null {
  const entries = shelfEntriesInLayoutOrder(books, layout);
  const member = parseStackMemberDragId(activeItemId);

  if (member) {
    const stackEntry = entries.find(
      (entry): entry is Extract<RenderableShelfEntry, { kind: "stack" }> =>
        entry.kind === "stack" && entry.stack.id === member.stackId,
    );
    const stackBook = stackEntry?.books.find(
      ({ item }) => item.id === member.bookItemId,
    );
    return stackBook ? { kind: "book", ...stackBook } : null;
  }

  return (
    entries.find((entry) => shelfEntryPlacementId(entry) === activeItemId) ??
    null
  );
}

function shelfDragAnnouncements(
  books: ShelfSnapshotDto["shelves"]["read"],
  layout: ShelfSceneLayout | null,
): Announcements {
  const describe = (dragId: string) => describeShelfDragId(books, layout, dragId);

  return {
    onDragStart({ active }) {
      return `Picked up ${describe(String(active.id))}.`;
    },
    onDragOver({ active, over }) {
      return over
        ? `Moving ${describe(String(active.id))} over ${describe(String(over.id))}.`
        : `${describe(String(active.id))} is not over a shelf position.`;
    },
    onDragEnd({ active, over }) {
      return over
        ? `Dropped ${describe(String(active.id))} on ${describe(String(over.id))}.`
        : `Dropped ${describe(String(active.id))} without changing its position.`;
    },
    onDragCancel({ active }) {
      return `Cancelled moving ${describe(String(active.id))}.`;
    },
  };
}

function describeShelfDragId(
  books: ShelfSnapshotDto["shelves"]["read"],
  layout: ShelfSceneLayout | null,
  dragId: string,
): string {
  const member = parseStackMemberDragId(dragId);
  if (member) {
    const item = layout?.items[member.bookItemId];
    const book =
      item?.kind === "book"
        ? books.find((candidate) => candidate.id === item.bookId)
        : null;
    return book ? `${book.title} from its stack` : "stack member";
  }

  if (parseShelfRowEndDragId(dragId)) return "end of the shelf row";

  const stackId = stackIdFromPlacementId(dragId);
  if (stackId) {
    const count = layout?.stacks[stackId]?.bookItemIds.length;
    return count ? `stack of ${count} books` : "book stack";
  }

  const item = layout?.items[dragId];
  const book =
    item?.kind === "book"
      ? books.find((candidate) => candidate.id === item.bookId)
      : null;
  return book?.title ?? "shelf position";
}

function snapshotBookIds(snapshot: ShelfSnapshotDto): ShelfBookIds {
  return {
    read: snapshot.shelves.read.map((book) => book.id),
    wantToRead: snapshot.shelves.wantToRead.map((book) => book.id),
  };
}

export type RenderableShelfEntry =
  | { kind: "book"; item: BookShelfItem; book: ShelfBookDto }
  | {
      kind: "stack";
      stack: HorizontalBookStackModel;
      books: Array<{
        item: BookShelfItem;
        book: ShelfBookDto;
      }>;
    };

export function shelfEntriesInLayoutOrder(
  books: ShelfSnapshotDto["shelves"]["read"],
  layout: ShelfSceneLayout | null,
): RenderableShelfEntry[] {
  if (!layout) {
    return books.map((book) => ({
      kind: "book",
      item: fallbackBookItem(book.id),
      book,
    }));
  }

  const booksById = new Map(books.map((book) => [book.id, book]));
  const displayedBookIds = new Set<number>();
  const stackMemberItemIds = new Set(
    Object.values(layout.stacks).flatMap((stack) => stack.bookItemIds),
  );
  const displayedEntries: RenderableShelfEntry[] = [];

  for (const row of layout.rows) {
    for (const itemId of row.items) {
      if (itemId.startsWith("stack:")) {
        const stack = layout.stacks[itemId.slice("stack:".length)];
        if (!stack) continue;
        const stackBooks = stack.bookItemIds.flatMap((memberItemId) => {
          const item = layout.items[memberItemId];
          if (!item || item.kind !== "book") return [];
          const book = booksById.get(item.bookId);
          if (!book || displayedBookIds.has(book.id)) return [];
          displayedBookIds.add(book.id);
          return [{ item, book }];
        });
        if (stackBooks.length > 0) {
          displayedEntries.push({ kind: "stack", stack, books: stackBooks });
        }
        continue;
      }

      const item = layout.items[itemId];

      if (
        !item ||
        item.kind !== "book" ||
        stackMemberItemIds.has(itemId) ||
        displayedBookIds.has(item.bookId)
      ) {
        continue;
      }

      const book = booksById.get(item.bookId);
      if (!book) {
        continue;
      }

      displayedBookIds.add(book.id);
      displayedEntries.push({ kind: "book", item, book });
    }
  }

  for (const book of books) {
    if (!displayedBookIds.has(book.id)) {
      displayedEntries.push({
        kind: "book",
        item: fallbackBookItem(book.id),
        book,
      });
    }
  }

  return displayedEntries;
}

function fallbackBookItem(bookId: number): BookShelfItem {
  return {
    id: `book:${bookId}`,
    kind: "book",
    rowId: "row:fallback:0",
    widthUnits: 1,
    bookId,
    presentation: "cover",
    orientation: "vertical",
  };
}

function shelfEntryPlacementId(entry: RenderableShelfEntry): string {
  return entry.kind === "book" ? entry.item.id : `stack:${entry.stack.id}`;
}

function presentationForBook(
  layout: ShelfLayout | null,
  bookId: number,
): BookPresentation {
  const itemId = `book:${bookId}`;

  for (const shelf of ["read", "wantToRead"] as const) {
    const item = layout?.shelves[shelf].items[itemId];

    if (item?.kind === "book") {
      return item.presentation;
    }
  }

  return "cover";
}

function orientationForBook(layout: ShelfLayout | null, bookId: number): BookOrientation {
  const itemId = `book:${bookId}`;
  for (const shelf of ["read", "wantToRead"] as const) {
    const item = layout?.shelves[shelf].items[itemId];
    if (item?.kind === "book") return item.orientation;
  }
  return "vertical";
}

function undoLayoutHistory(history: ShelfLayoutHistory): ShelfLayoutHistory {
  const previousLayout = history.past.at(-1);

  if (!previousLayout || !history.current) {
    return history;
  }

  return {
    current: previousLayout,
    past: history.past.slice(0, -1),
    future: [history.current, ...history.future].slice(
      0,
      MAX_LAYOUT_HISTORY_ENTRIES,
    ),
  };
}

function redoLayoutHistory(history: ShelfLayoutHistory): ShelfLayoutHistory {
  const nextLayout = history.future[0];

  if (!nextLayout || !history.current) {
    return history;
  }

  return {
    current: nextLayout,
    past: [...history.past, history.current].slice(
      -MAX_LAYOUT_HISTORY_ENTRIES,
    ),
    future: history.future.slice(1),
  };
}

function reconcileLayoutHistory(
  history: ShelfLayoutHistory,
  bookIds: ShelfBookIds,
  fallback: ShelfLayout,
): ShelfLayoutHistory {
  if (!history.current) {
    return { current: fallback, past: [], future: [] };
  }

  return {
    current: reconcileShelfLayout(history.current, bookIds),
    past: history.past.map((layout) => reconcileShelfLayout(layout, bookIds)),
    future: history.future.map((layout) => reconcileShelfLayout(layout, bookIds)),
  };
}

function getBrowserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
