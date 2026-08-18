import type {
  DraggableAttributes,
  DraggableSyntheticListeners,
} from "@dnd-kit/core";
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
  drag,
}: HorizontalBookStackProps) {
  const stackWidthScale = Math.max(
    ...books.map(({ book }) => bookHeightScale(book)),
  );
  let offsetRem = 0;
  const style: StackStyle = {
    "--stack-width": `calc(var(--shelf-book-height) * ${stackWidthScale.toFixed(3)})`,
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
      {...drag?.attributes}
      {...drag?.listeners}
      role="listitem"
    >
      {books.map(({ item, book }, index) => {
        const currentOffset = offsetRem;
        offsetRem += bookSpineWidthRem(book);

        return (
          <BookCard
            key={item.id}
            book={book}
            eager={eager}
            presentation={item.presentation}
            orientation="horizontal"
            stackIndex={index}
            isStacked
            stackOffsetRem={currentOffset}
            isEditing={isEditing}
            isSelectedForEditing={selectedBookIds.includes(book.id)}
            onSelectForEditing={() => onSelectBookForEditing?.(book.id)}
          />
        );
      })}
    </li>
  );
}
