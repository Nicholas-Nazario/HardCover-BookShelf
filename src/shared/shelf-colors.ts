export const BOOK_SPINE_PALETTE = [
  "#7c2d12",
  "#1e3a5f",
  "#365314",
  "#5b21b6",
  "#831843",
  "#374151",
] as const;

export function bookSpinePaletteIndex(bookId: number): number {
  let hash = 2_166_136_261;

  for (const character of String(bookId)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }

  return (hash >>> 0) % BOOK_SPINE_PALETTE.length;
}

export function bookSpineColor(bookId: number): string {
  return BOOK_SPINE_PALETTE[bookSpinePaletteIndex(bookId)];
}
