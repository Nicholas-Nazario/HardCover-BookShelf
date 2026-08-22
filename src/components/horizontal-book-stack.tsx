import type {
  DraggableAttributes,
  DraggableSyntheticListeners,
} from "@dnd-kit/core";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { CSSProperties } from "react";
import type {
  BookShelfItem,
  HorizontalBookStack as HorizontalBookStackModel,
} from "../client/shelf-layout";
import type { ShelfBookDto } from "../client/shelf-api";
import { BookCard, bookHeightScale, bookSpineWidthRem } from "./book-card";

type StackBook = { item: BookShelfItem; book: ShelfBookDto };

interface HorizontalBookStackProps {
  stack: HorizontalBookStackModel;
  books: StackBook[];
  eager?: boolean;
  isEditing?: boolean;
  selectedBookIds?: readonly number[];
  onSelectBookForEditing?: (bookId: number) => void;
  onUnstack?: () => void;
  dropPreviewMemberItemId?: string | null;
  drag?: {
    attributes: DraggableAttributes;
    listeners: DraggableSyntheticListeners | undefined;
    setNodeRef: (node: HTMLElement | null) => void;
    isDragging: boolean;
    isDropPreview: boolean;
  };
}

type StackStyle = CSSProperties & Record<`--${string}`, string>;

export function HorizontalBookStack({
  stack,
  books,
  eager = false,
  isEditing = false,
  selectedBookIds = [],
  onSelectBookForEditing,
  onUnstack,
  dropPreviewMemberItemId = null,
  drag,
}: HorizontalBookStackProps) {
  const stackWidthScale = Math.max(
    ...books.map(({ book }) => bookHeightScale(book)),
  );
  let offsetRem = 0;
  const style: StackStyle = {
    "--stack-width": `calc(var(--shelf-book-height) * ${stackWidthScale.toFixed(3)})`,
    "--stack-height": `${books.reduce(
      (height, { book }) => height + bookSpineWidthRem(book),
      0,
    ).toFixed(3)}rem`,
  };

  return (
    <li
      className="book-stack"
      data-stack-id={stack.id}
      data-dragging={drag?.isDragging || undefined}
      data-drop-preview={drag?.isDropPreview || undefined}
      ref={drag?.setNodeRef}
      style={style}
      aria-label={`Stack of ${books.length} books`}
      role="listitem"
    >
      {isEditing && (drag || onUnstack) ? (
        <span className="book-stack-controls">
          {drag ? (
            <button
              className="book-stack-drag-handle"
              type="button"
              aria-label={`Move stack of ${books.length} books`}
              title="Move stack"
              {...drag.attributes}
              {...drag.listeners}
            >
              <span aria-hidden="true">↕</span>
            </button>
          ) : null}
          {onUnstack ? (
            <button
              className="book-stack-unstack-button"
              type="button"
              onClick={onUnstack}
            >
              Unstack books
            </button>
          ) : null}
        </span>
      ) : null}
      {books.map(({ item, book }, index) => {
        const currentOffset = offsetRem;
        offsetRem += bookSpineWidthRem(book);

        return isEditing ? (
          <DraggableStackMemberBook
            key={item.id}
            stackId={stack.id}
            item={item}
            book={book}
            eager={eager}
            stackIndex={index}
            stackOffsetRem={currentOffset}
            isSelectedForEditing={selectedBookIds.includes(book.id)}
            onSelectForEditing={() => onSelectBookForEditing?.(book.id)}
            isDropPreview={dropPreviewMemberItemId === item.id}
          />
        ) : (
          <BookCard
            key={item.id}
            book={book}
            eager={eager}
            presentation={item.presentation}
            orientation="horizontal"
            stackIndex={index}
            isStacked
            stackOffsetRem={currentOffset}
          />
        );
      })}
    </li>
  );
}

interface DraggableStackMemberBookProps {
  stackId: string;
  item: BookShelfItem;
  book: ShelfBookDto;
  eager: boolean;
  stackIndex: number;
  stackOffsetRem: number;
  isSelectedForEditing: boolean;
  onSelectForEditing: () => void;
  isDropPreview: boolean;
}

function DraggableStackMemberBook({
  stackId,
  item,
  book,
  eager,
  stackIndex,
  stackOffsetRem,
  isSelectedForEditing,
  onSelectForEditing,
  isDropPreview,
}: DraggableStackMemberBookProps) {
  const dragId = stackMemberDragId(stackId, item.id);
  const draggable = useDraggable({ id: dragId });
  const droppable = useDroppable({ id: dragId });

  return (
    <BookCard
      book={book}
      eager={eager}
      presentation={item.presentation}
      orientation="horizontal"
      stackIndex={stackIndex}
      isStacked
      stackOffsetRem={stackOffsetRem}
      isEditing
      isSelectedForEditing={isSelectedForEditing}
      onSelectForEditing={onSelectForEditing}
      drag={{
        attributes: draggable.attributes,
        listeners: draggable.listeners,
        setNodeRef: (node) => {
          draggable.setNodeRef(node);
          droppable.setNodeRef(node);
        },
        isDragging: draggable.isDragging,
        isDropPreview,
        handleLabel: `Move ${book.title} out of stack`,
        handleOnly: true,
      }}
    />
  );
}

export function stackMemberDragId(stackId: string, bookItemId: string): string {
  return `stack-member:${stackId}:${bookItemId}`;
}
