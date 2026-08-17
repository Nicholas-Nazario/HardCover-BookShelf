import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const globalCss = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
const shelfGrain = readFileSync(
  new URL("../../public/shelf-grain.svg", import.meta.url),
  "utf8",
);

describe("bookshelf responsive CSS", () => {
  it("uses packed variable-width covers and spines on responsive shelf rows", () => {
    expect(globalCss).toMatch(/\.shelf-route\s*\{[\s\S]*?min-height:\s*100svh;/);
    expect(globalCss).toMatch(/\.bookshelf\s*\{[\s\S]*?display:\s*flex;/);
    expect(globalCss).toMatch(
      /\.bookshelf\s*\{[\s\S]*?flex-wrap:\s*wrap;/,
    );
    expect(globalCss).toMatch(
      /\.bookshelf\s*\{[\s\S]*?repeating-linear-gradient\(/,
    );
    expect(globalCss).toMatch(
      /\[data-shelf-overlays~="wood-grain"\] \.bookshelf::before\s*\{[\s\S]*?mask-image:\s*url\("\/shelf-grain\.svg"\);/,
    );
    expect(globalCss).toMatch(
      /\.bookshelf::before\s*\{\s*content:\s*none;/,
    );
    expect(globalCss).not.toMatch(
      /\.book-card:nth-child\([\s\S]*?transform:\s*rotate/,
    );
    expect(globalCss).not.toContain("--shelf-knot-");
    expect(shelfGrain).toContain('id="grain"');
    expect(shelfGrain).toContain('id="knots"');
    expect(globalCss).toMatch(
      /\.book-card\s*\{[\s\S]*?flex:\s*0 0 var\(--book-width\);/,
    );
    expect(globalCss).not.toMatch(/\.bookshelf\s*\{[^}]*grid-template-columns:/);
    expect(globalCss).toMatch(
      /\.book-cover\s*\{[\s\S]*?height:\s*var\(--book-height\);/,
    );
    expect(globalCss).toMatch(/\.book-cover-image\s*\{[\s\S]*?object-fit:\s*cover;/);
    expect(globalCss).toMatch(
      /\.book-spine\s*\{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*var\(--book-height\);[\s\S]*?var\(--book-color\);/,
    );
    expect(globalCss).toMatch(
      /\.book-spine-cover-image\s*\{[\s\S]*?filter:\s*blur\([^)]*\)[\s\S]*?object-fit:\s*fill;/,
    );
    expect(globalCss).toMatch(
      /\.book-spine-copy\s*\{[\s\S]*?font-size:\s*var\(--spine-font-size\);/,
    );
    expect(globalCss).toMatch(
      /\.book-spine-copy\s*\{[\s\S]*?white-space:\s*nowrap;/,
    );
    expect(globalCss).toMatch(
      /\.book-spine-copy\[data-wrapped="true"\]\s*\{[\s\S]*?display:\s*grid;/,
    );
    expect(globalCss).toMatch(
      /\.book-spine-copy\[data-wrapped="true"\]\[data-title-lines="2"\][\s\S]*?\.book-spine-title--wrapped\[data-title-layout="2"\][\s\S]*?display:\s*grid;/,
    );
    expect(globalCss).toMatch(/\.book-dialog-backdrop\s*\{[\s\S]*?position:\s*fixed;/);
    expect(globalCss).toMatch(/\.book-dialog-copy h2\s*\{[\s\S]*?overflow-wrap:\s*anywhere;/);
    expect(globalCss).toMatch(
      /\.book-dialog-subtitle\s*\{[\s\S]*?font-size:\s*clamp\(1\.15rem, 2\.2vw, 1\.65rem\);/,
    );
    expect(globalCss).toMatch(/body\s*\{[\s\S]*?overflow-x:\s*clip;/);
    expect(globalCss).toMatch(
      /@media \(max-width: 34rem\)[\s\S]*?\.bookshelf\s*\{[\s\S]*?--shelf-book-height:\s*clamp/,
    );
    expect(globalCss).toMatch(/\.shelf-action-button:focus-visible/);
    expect(globalCss).toMatch(
      /\.settings-dialog-backdrop\s*\{[\s\S]*?position:\s*fixed;/,
    );
    expect(globalCss).toMatch(/\.book-cover-button:focus-visible/);
    expect(globalCss).toMatch(/\.book-presentation-options input:focus-visible/);
  });
});
