# Shelf Editor Implementation Guide

## Purpose

This document is the implementation reference for the major shelf-editor upgrade.
It defines the product decisions that have already been made and the architecture
to use when adding reordering, varied book orientations, gaps, and static decor.

### In scope

- Drag-and-drop editing with an iPhone-style prospective layout preview.
- Variable-width books and decor.
- Vertical books, horizontal books, and stacks of horizontal books.
- Deliberate blank space.
- Static local SVG and PNG knick-knacks.
- Browser-local persistence, scoped to a Hardcover username.

### Explicitly deferred

- Animated sprites and animated decor.
- Authentication and syncing a layout between devices.
- Sharing or editing another person’s saved layout.

## Implementation progress

Update this section as each checkpoint is completed. A checkpoint is complete
only when its relevant automated tests and the verification steps at the end of
this document pass.

### Completed work

- [x] Defined the shelf-scene model, variable-width layout approach, local-only
  persistence direction, and drag-preview interaction.
- [x] Added the initial static plant assets under `public/decor/plants/`.
- [x] Recorded provenance and CC BY-SA 3.0 attribution requirements for the
  initial plant assets.
- [x] Checkpoint 1 — Added versioned layout types, validation, browser-local
  storage, presentation-preference migration, and book reconciliation.
- [x] Checkpoint 2 — Rendered books from their persisted scene order and saved
  cover/spine presentation, including refresh reconciliation.
- [x] Checkpoint 3 — Added edit-mode history with bounded undo/redo, toolbar
  controls, and keyboard shortcuts.
- [x] Checkpoint 4 — Added drag sensors, lifted drag overlays, dotted placement
  previews, and persisted insertion reordering.

### Next up

- [ ] Checkpoint 6 — Add persistent, resizable blank-space items.

### Checkpoints

- [x] Checkpoint 1 — Layout foundation and migration.
- [x] Checkpoint 2 — Render the persisted variable-width book scene.
- [x] Checkpoint 3 — Editor controls, selection, and undo/redo.
- [x] Checkpoint 4 — Drag preview, displacement solver, and accessible drag
  controls.
- [x] Checkpoint 5 — Horizontal books, multi-select stack creation, and grouped
  stack rendering.
- [x] Checkpoint 5b — Stack editing and member drag interactions.
- [ ] Checkpoint 6 — Persistent blank-space items.
- [ ] Checkpoint 7 — Static decor picker, renderer, and placement using the
  licensed plant assets.

## Product principles

1. A user is arranging a shelf scene, not sorting a list.
2. Every visible thing has a real place in the layout, including blank space.
3. An item keeps its natural width. The editor must never reduce every item to
   equal-size cells.
4. While a user drags an item, the shelf always shows the exact layout that will
   result from dropping it at the current pointer or keyboard position.
5. Existing saved scenes remain intact when Hardcover synchronization adds books.

## Layout model

The shelf is a set of horizontal packing lanes (visual shelf rows). Each item has
a variable width in shelf-relative units, not in persisted pixels. At render time,
the available viewport width converts those units to CSS dimensions.

The primary placement model is ordered rows:

```ts
type ShelfRow = {
  id: string;
  items: string[];
};

type ShelfItem =
  | BookShelfItem
  | SpacerShelfItem
  | DecorShelfItem;

type BaseShelfItem = {
  id: string;
  rowId: string;
  widthUnits: number;
};

type BookShelfItem = BaseShelfItem & {
  kind: "book";
  bookId: number;
  presentation: "cover" | "spine";
  orientation: "vertical" | "horizontal";
};

type SpacerShelfItem = BaseShelfItem & {
  kind: "spacer";
  heightUnits?: number;
};

type DecorShelfItem = BaseShelfItem & {
  kind: "decor";
  assetId: string;
  heightUnits: number;
};

type ShelfLayout = {
  version: 1;
  rows: ShelfRow[];
  items: Record<string, ShelfItem>;
};
```

`widthUnits` represents the item’s visual width relative to the shelf rather
than a hard-coded pixel value. A book’s initial width comes from the existing
cover/spine presentation rules; a decor asset supplies its default from the asset
manifest. A spacer’s width is chosen by the user.

Rows should have a capacity derived from the rendered shelf width. The layout
solver packs variable-width items left-to-right, wrapping overflow into later
rows. It must be pure: given an input layout and an operation, it returns a new
layout without touching the DOM or React state.

## Horizontal books and stacks

A horizontal book is an individual shallow, wide item. It is not a rotated
vertical card with a transformed hit area, a rotated cover, or a page-edge
placeholder. It renders a dedicated **horizontal spine**: the title and author
are readable along its long edge, using the same deterministic spine color and
book-identification information as an upright spine. Its layout dimensions and
rendering are defined directly by `orientation: "horizontal"`.

A stack is a first-class grouped shelf item with one physical footprint and an
ordered set of horizontal book members. It is not a CSS overlap applied to
otherwise independent flow items.

Edit mode supports multi-selection. Selecting a book toggles it into the current
selection; selected books remain visibly highlighted. When two or more books
are selected on the active shelf, the toolbar presents **Stack these books**.

That action forces every selected book horizontal, preserves its book-specific
spine appearance, replaces their normal row entries with one `stack:<id>` at the
earliest selected location, and saves the ordered members in a persistent
`HorizontalBookStack`. The complete operation is one undoable history change.

The renderer resolves `stack:<id>` into one relative-positioned stack container.
Its member books layer bottom-to-top on a shared edge and do not render again as
ordinary row items. Each member must reuse the existing `SpineArtwork`—including
blurred cover, color, glaze, metadata-driven dimensions, and fitted title/author
typography. Only physical orientation and placement change.

Initially, a completed stack is draggable as one unit. Pulling books out of a
stack or dropping books onto one is a later refinement.

### Checkpoint 5b — Stack editing

After grouped stack rendering is stable, add explicit controls and drag rules
for editing an existing stack:

- Provide an **Unstack books** action that replaces the stack placement with
  its ordered member book placements in the same row.
- Allow an individual member to be dragged out of a stack. Removing it inserts
  the horizontal book at the resolved drop position and preserves the order of
  the remaining members.
- Allow an unstacked horizontal book to be dragged onto an existing stack. Add
  it at the resolved member position and remove its former row placement.
- Keep vertical books ineligible for a stack drop until they are explicitly
  changed to horizontal, so a drag does not silently change presentation.
- Automatically dissolve a stack when only one member remains, replacing the
  `stack:<id>` placement with that final horizontal book at the same row
  position.
- Commit each unstack, add, remove, or automatic-dissolve operation as one
  undoable history action and persist the result immediately.
- Keep stack-member order stable through undo, redo, refresh reconciliation,
  and reload.

Checkpoint 5b tests must cover explicit unstacking, adding a horizontal book,
removing a member, one-book automatic dissolution, exact row/member ordering,
undo/redo, and persistence across reload.

The renderer should use a small vertical visual offset and shelf shadow to make
each horizontal spine legible. Initial geometry should be approximately 1.5
upright-book-width units wide and 0.25–0.3 units high; tune those values against
real covers during implementation. Its pointer and keyboard target must remain
the full stored rectangle.

## Gaps

Blank space is a `spacer` item. It participates in ordering, drag displacement,
undo/redo, and persistence just like a book. It must not be inferred from an
absence of items, otherwise it will disappear whenever the shelf reflows.

The edit toolbar needs an **Add gap** control. A new gap receives a sensible
default width and can be resized or removed while editing.

## Drag-and-drop behavior

Use `@dnd-kit/core` for pointer, touch, and keyboard sensors, plus its drag
overlay support. Do not use a generic sortable strategy as the source of truth:
the shelf requires a custom variable-width layout solver.

During a drag:

1. Preserve an immutable `dragStartLayout`.
2. Render the source item in a drag overlay so it does not affect normal flow.
3. Convert the pointer/keyboard location into a candidate row and insertion
   position using the measured variable-width item rectangles.
4. Call the pure solver to build `previewLayout`. The solver inserts the item,
   shifts later items to make room, and cascades overflow into following rows.
5. Render `previewLayout` below the overlay. The proposed footprint has a dotted
   outline; displaced items animate to their preview positions.
6. Commit `previewLayout` only on drop. Escape, cancellation, or a failed drop
   restores `dragStartLayout`.

Use transform-based FLIP animation for displaced items. Respect
`prefers-reduced-motion`: show the preview and dotted target without movement
animation.

The keyboard interaction must support pick up, move between insertion positions
and rows, drop, and cancel, with live-region announcements of the prospective
location.

## Persistence

Persist layouts in browser `localStorage` only for this phase. Layouts are keyed
by normalized username:

```text
hardcover-shelf:layout:v1:<normalized-username>
```

Validate stored JSON before use. Malformed or unknown versions must safely fall
back to an automatically generated layout.

When a Hardcover refresh adds books, retain all existing scene items and append
only unplaced books through the automatic-placement pass. When books disappear
from the imported shelf, retain no orphaned book layout entries in the active
scene; remove them during reconciliation. Never replace a valid saved layout
because an upstream book’s metadata changed.

Use a versioned client module separate from `book-presentations.ts`. It will
replace the current presentation-only preferences after migration, preserving
existing cover/spine choices when creating the initial layout.

## Static decor assets

Decor is app-owned and stored locally under `public/`; do not hotlink assets
from third-party libraries. Keep an asset manifest in source control containing
the display and licensing information needed by the editor:

```ts
type StaticDecorAsset = {
  id: string;
  label: string;
  src: string;
  format: "svg" | "png";
  intrinsicWidth: number;
  intrinsicHeight: number;
  defaultWidthUnits: number;
  defaultHeightUnits: number;
  license: string;
  attribution?: string;
  sourceUrl?: string;
};
```

Choose SVG for clean vector illustrations such as vases, plants, candles, and
simple objects. Choose PNG for pixel art, painting-like work, or detailed raster
textures. Do not convert pixel art into SVG. Future sprite animation will extend
the decor item/asset types; it is intentionally not part of this milestone.

### Initial plant assets and licensing

The initial static-decor references are SVG plants in `public/decor/plants/`:

| Asset ID | Public path | License |
| --- | --- | --- |
| `potted-plant-1` | `/decor/plants/potted_plant1.svg` | CC BY-SA 3.0 Unported |
| `potted-plant-2` | `/decor/plants/potted_plant2.svg` | CC BY-SA 3.0 Unported |
| `potted-plant-3` | `/decor/plants/potted_plant3.svg` | CC BY-SA 3.0 Unported |

Source: [Potted Plants Flat Design (SVG editable) on OpenGameArt](https://opengameart.org/content/potted-plants-flat-design-svg-editable).
It was published by **Techspired Minds** on November 22, 2022, as the result of
the Flat Design Potted Plants tutorial by Pixel & Bracket. The required
copyright/attribution notice is: **“Potted Plants by Techspired Minds.”**

CC BY-SA 3.0 permits copying, redistribution, and adaptation, including
commercially, but requires appropriate credit, a link to the license, and an
indication of changes. Adaptations must be distributed under the same or a
compatible license. See the [official CC BY-SA 3.0 deed](https://creativecommons.org/licenses/by-sa/3.0/).

Before shipping these assets, add the author, source URL, license link, and the
required attribution notice to each manifest entry, and make the attribution
visible in an in-app Credits or Licenses view.

## Component boundaries

Keep drag state and the scene model out of `ShelfView` as the feature grows.
Suggested responsibilities:

- `ShelfView`: loads the Hardcover snapshot, owns the selected shelf, and enters
  or exits edit mode.
- `ShelfScene`: loads/reconciles the persisted layout and renders the scene.
- `ShelfEditor`: owns editing tools, selection, undo/redo, and drag lifecycle.
- `ShelfLayoutSolver`: pure placement, insertion, overflow, and reconciliation
  functions with no React dependencies.
- `ShelfItemRenderer`: selects the book, spacer, or decor renderer.
- `shelf-layout.ts`: types, validation, local-storage keys, migration, and
  persistence.
- `static-decor-assets.ts`: the local asset manifest.

Existing `BookCard` detail behavior should remain available outside edit mode.
In edit mode, dragging takes precedence over opening details; a distinct select
action can retain presentation/orientation controls.

## Delivery order

1. Add the layout types, validation, local storage, migration from current
   book-presentation preferences, and automatic layout generation.
2. Render a persisted variable-width scene with existing vertical books.
3. Add the editor toolbar, selection, undo/redo, and book presentation controls.
4. Add custom drag sensors, preview solver, dotted footprint, and displacement
   animation.
5. Add horizontal orientation and the stack-alignment action.
6. Add and edit spacer items.
7. Add the static decor manifest, picker, renderer, and placement flow once the
   PNG/SVG assets are available.

## Verification checklist

- Unit-test the solver for variable widths, wrapping, insertion, spacers, and
  no-overlap guarantees.
- Unit-test stored-layout parsing, version fallback, migration, and refresh
  reconciliation.
- Component-test pointer-independent editing controls and keyboard drag flow.
- Verify touch drag on a narrow viewport.
- Verify the rendered layout at small and wide viewport sizes.
- Verify canceled drags make no storage change and undo/redo restores exact
  layouts.
- Verify all PNG/SVG assets have recorded provenance and license information.
- Run `npm test`, `npm run typecheck`, and `npm run build` before handoff.
