# Book Metadata and Covers Implementation Guide

Status: Implemented  
Last updated: 2026-08-17

## 1. Purpose

This document is the development reference for adding richer, non-edition book metadata and canonical Hardcover cover images to Hardcover Shelf.

The current proof of concept synchronizes enough data to render colored book spines: Hardcover book ID, title, author names, shelf status, and the Hardcover `user_books` relationship ID. This feature will retain the cached-snapshot architecture while replacing the minimal spine presentation with cover-led book cards and useful supporting metadata.

If another project document still describes cover images as deferred, this feature guide supersedes that decision for canonical book covers only. Edition-specific data remains deferred.

## 2. Decision summary

The feature will add:

- The canonical Hardcover book cover URL and its dimensions.
- The Hardcover book slug used to link back to the book page.
- Series identity, name, and book position.
- Original release year.
- Page count.
- Hardcover community rating and rating count.
- The public shelf owner's rating.
- The shelf owner's first and last read dates.

The feature will not add editions, ISBNs, publishers, languages, or formats.

Hardcover IDs remain the application's identifiers:

- `books.hardcover_book_id` continues to identify the conceptual book/work.
- `profiles.hardcover_user_id` continues to identify the profile.
- `profile_books.hardcover_user_book_id` continues to identify the user's Hardcover shelf entry.
- `(hardcover_user_id, hardcover_book_id)` remains the local identity for a book on a profile's shelf.

ISBNs must not be used as primary or fallback identifiers. An ISBN identifies a particular edition, can be missing, and is not one-to-one with a Hardcover book.

## 3. Goals

1. Make real covers the primary visual element of the bookshelf.
2. Give each card enough context to be useful without opening Hardcover.
3. Link each book back to its canonical Hardcover page when a slug is available.
4. Preserve cached-first loading and explicit refresh behavior.
5. Keep all Hardcover API calls and credentials server-side.
6. Preserve the last good snapshot when a synchronization fails.
7. Render sensible fallbacks for incomplete Hardcover metadata.
8. Keep the database and API contracts application-owned rather than exposing raw Hardcover data.

## 4. Non-goals

The following are explicitly outside this feature:

- Selected or default editions.
- ISBN-10 or ISBN-13.
- Publisher, language, country, physical format, or reading format.
- Edition-specific covers, page counts, or release dates.
- Descriptions, subtitles, tags, reviews, rating distributions, or reading-session history.
- Additional shelf statuses beyond Read (`3`) and Want to Read (`1`).
- Sorting, searching, or filtering the shelf by the new metadata.
- A generic Hardcover GraphQL proxy.
- Client-side calls to Hardcover.
- Downloading or permanently mirroring cover image files into SQLite or the application image.

Edition support should be designed separately. When introduced, it should use Hardcover edition IDs and an edition-specific data model rather than expanding this feature's book columns with ISBN-based identity.

## 5. Existing architecture to preserve

The implementation must continue to follow this flow:

```text
Hardcover GraphQL API
        |
        v
server/hardcover adapter and validation
        |
        v
application-owned PublicShelfBook model
        |
        v
atomic SQLite snapshot replacement
        |
        v
application-owned ShelfSnapshotDto
        |
        v
client validation and bookshelf UI
```

Important existing behavior:

- A normal cached page load reads only from SQLite.
- A first load synchronizes only when no snapshot exists.
- Refresh replaces the snapshot only after the complete Hardcover library has been fetched successfully.
- A failed refresh leaves the previous snapshot intact and visible.
- The existing status and public-entry filters remain unchanged.
- Library pages continue to be fetched sequentially before opening the SQLite transaction.

## 6. Hardcover query contract

Extend the existing `PublicShelfBooks` GraphQL document. Do not add a second per-book request or an N+1 query.

The relevant selection should be:

```graphql
query PublicShelfBooks($userId: Int!, $limit: Int!, $offset: Int!) {
  user_books(
    where: {
      user_id: { _eq: $userId }
      status_id: { _in: [1, 3] }
      privacy_setting_id: { _eq: 1 }
    }
    distinct_on: book_id
    order_by: [{ book_id: asc }]
    limit: $limit
    offset: $offset
  ) {
    id
    status_id
    book_id
    privacy_setting_id
    rating
    first_read_date
    last_read_date
    book {
      id
      title
      slug
      release_year
      pages
      rating
      ratings_count
      image {
        url
        width
        height
      }
      contributions {
        author {
          name
        }
      }
      book_series {
        featured
        position
        series {
          id
          name
        }
      }
    }
  }
}
```

Do not query `user_books.edition`, `book.default_cover_edition`, `book.editions`, or any ISBN field.

### 6.1 Field ownership

The two `rating` fields have different meanings:

- `book.rating` is the Hardcover community average.
- `user_books.rating` is the public shelf owner's personal rating.

The implementation must give them distinct application names so they cannot be confused.

### 6.2 Nullability and validation

The adapter must normalize Hardcover values into stable application types:

- `slug`: trimmed non-empty string or `null`.
- `release_year`: safe integer or `null`.
- `pages`: positive safe integer or `null`.
- `communityRating`: finite number from 0 through 5 or `null`.
- `ratingsCount`: non-negative safe integer.
- `userRating`: finite number from 0 through 5 or `null`.
- `firstReadDate` and `lastReadDate`: `YYYY-MM-DD` string or `null`.
- Cover width and height: positive safe integers or `null`.
- Series position: finite number or `null`; fractional positions are valid.

Hardcover's GraphQL `numeric` scalar should be normalized to a JavaScript number in the adapter even if the upstream JSON representation is a numeric string. Raw scalar representations must not leak into repository or UI types.

Core identity and title failures should continue to reject the upstream page. Missing optional metadata should not make an otherwise valid book disappear.

### 6.3 Cover URL policy

Only retain a cover when all of the following are true:

- The value parses as an absolute URL.
- The protocol is `https:`.
- The hostname is `assets.hardcover.app`.
- The URL does not contain credentials.
- The port is empty/default.

If a cover URL fails validation, normalize the cover to `null` and render the fallback. Do not fail an entire profile synchronization because one optional image URL is unusable.

If Hardcover begins returning another Hardcover-controlled asset hostname, add it explicitly to both the server-side allowlist and the Next.js image configuration after validating it. Do not accept arbitrary remote hosts or a broad wildcard.

### 6.4 Series normalization

A book can belong to more than one series. Preserve all valid series relationships as a small array rather than selecting only the first one.

Each normalized series item should contain:

```ts
interface BookSeries {
  id: number;
  name: string;
  position: number | null;
  featured: boolean;
}
```

Rules:

- Drop a relationship with a missing series object, invalid ID, or blank name.
- Deduplicate by Hardcover series ID.
- Put the featured relationship first.
- Sort remaining relationships by series name and then ID for deterministic snapshots.
- Preserve fractional positions.

The series ID is stored for stable identity and deduplication even though the initial UI primarily displays name and position.

## 7. Application-owned domain contract

Extend `PublicShelfBook` in `src/server/hardcover/library.ts` to this conceptual shape:

```ts
interface BookCover {
  url: string;
  width: number | null;
  height: number | null;
}

interface BookSeries {
  id: number;
  name: string;
  position: number | null;
  featured: boolean;
}

interface PublicShelfBook {
  id: number;
  hardcoverUserBookId: number;
  title: string;
  authors: string[];
  statusId: 1 | 3;
  slug: string | null;
  cover: BookCover | null;
  releaseYear: number | null;
  pages: number | null;
  communityRating: number | null;
  ratingsCount: number;
  series: BookSeries[];
  userRating: number | null;
  firstReadDate: string | null;
  lastReadDate: string | null;
}
```

The exact exported type names may follow repository conventions, but the semantics and nullability above are the contract.

## 8. SQLite data model

### 8.1 Shared book metadata

Add these fields to `books`:

| Application field | SQLite column | Type | Default |
| --- | --- | --- | --- |
| `slug` | `slug` | text nullable | `NULL` |
| `cover.url` | `cover_url` | text nullable | `NULL` |
| `cover.width` | `cover_width` | integer nullable | `NULL` |
| `cover.height` | `cover_height` | integer nullable | `NULL` |
| `releaseYear` | `release_year` | integer nullable | `NULL` |
| `pages` | `pages` | integer nullable | `NULL` |
| `communityRating` | `community_rating` | real nullable | `NULL` |
| `ratingsCount` | `ratings_count` | integer not null | `0` |
| `series` | `series_json` | text JSON not null | `[]` |

These fields describe a Hardcover book/work and belong on `books`.

Do not make `slug` unique. Hardcover book ID remains authoritative, and a slug can be absent or change.

### 8.2 Profile-specific metadata

Add these fields to `profile_books`:

| Application field | SQLite column | Type | Default |
| --- | --- | --- | --- |
| `userRating` | `user_rating` | real nullable | `NULL` |
| `firstReadDate` | `first_read_date` | text nullable | `NULL` |
| `lastReadDate` | `last_read_date` | text nullable | `NULL` |

These values belong to the profile/book relationship. They must not be stored on `books`, because two profiles can rate or read the same book differently.

### 8.3 Why series is JSON for this feature

The first version only needs to display a book's series relationships from a synchronized snapshot. A JSON array keeps the migration and repository query small while preserving multiple series.

Normalize series into dedicated tables later if the application needs cross-book series queries, series pages, filtering, or referential updates. Do not introduce those tables speculatively in this feature.

### 8.4 Migration requirements

1. Update `src/db/schema.ts`.
2. Generate a new versioned Drizzle migration with `npm run db:generate`.
3. Do not edit `0000_initial.sql`.
4. Ensure existing rows receive `ratings_count = 0` and `series_json = []`.
5. Ensure the migration works for both a new empty database and an existing PoC database.
6. Keep all new metadata updates inside the existing atomic snapshot transaction.

No destructive rebuild or manual production database edit should be required.

## 9. Repository and snapshot mapping

### 9.1 Snapshot replacement

When upserting `books`, update every shared metadata column along with title and authors. This prevents stale cover, rating, or series data after refresh.

When inserting `profile_books`, persist the public shelf owner's rating and read dates alongside the existing relationship ID and status.

If metadata changes to `null` upstream, write `NULL`; do not preserve a stale previous value.

### 9.2 Read DTO

Extend `ShelfBookDto` in both server and client contracts:

```ts
interface ShelfBookDto {
  id: number;
  title: string;
  authors: string[];
  slug: string | null;
  cover: {
    url: string;
    width: number | null;
    height: number | null;
  } | null;
  releaseYear: number | null;
  pages: number | null;
  communityRating: number | null;
  ratingsCount: number;
  series: Array<{
    id: number;
    name: string;
    position: number | null;
    featured: boolean;
  }>;
  userRating: number | null;
  firstReadDate: string | null;
  lastReadDate: string | null;
}
```

The API must always include every field, using `null` or `[]` where data is unavailable. Do not omit keys conditionally.

The browser-side `isShelfBook` validator must validate the complete contract, including nested cover and series data. It must reject malformed server responses with the existing safe client error.

## 10. UI specification

### 10.1 Component model

Replace the spine-specific presentation with a `BookCard` component. The old deterministic color palette remains useful for cover fallbacks.

Recommended structure:

```text
li.book-card
`-- article
    |-- cover/link region
    |   `-- canonical cover or colored fallback
    |-- title
    |-- author line
    |-- series line, when present
    |-- publication facts
    |-- community rating
    `-- shelf-owner rating/read dates, when present
```

The shelf container should become a responsive CSS grid of consistent cards rather than a flex row of variable-width spines.

### 10.2 Cover behavior

- Use `next/image` for a validated canonical cover.
- Configure an exact `https://assets.hardcover.app/**` `remotePatterns` entry in `next.config.ts`.
- Set `maximumRedirects: 0` unless live validation demonstrates a required Hardcover redirect.
- Use the API width and height when both are valid.
- When dimensions are unavailable, use `fill` inside a positioned container with a stable book-cover aspect ratio.
- Supply an accurate `sizes` value for the responsive card width.
- Leave lazy loading enabled; a shelf can contain hundreds of covers.
- Do not preload every cover.
- Use `object-fit: cover` or `contain` consistently. `contain` is preferred when preserving the complete cover art is more important than edge-to-edge fill.
- If the image fails to load, reveal the deterministic colored fallback without removing the title or author text.

Because the visible card already contains title and author text, the cover can use `alt=""` to avoid announcing duplicate content. The card link itself must still have an accessible name derived from the title and authors.

### 10.3 Hardcover links

When `slug` is present, link to:

```text
https://hardcover.app/books/{encoded-slug}
```

Do not construct the link from the title or book ID. Do not render a dead anchor when the slug is missing.

The link should identify that it opens the book on Hardcover. Opening in the same tab is the default; if development chooses a new tab, add the appropriate `rel` attributes and accessible context.

### 10.4 Visible metadata hierarchy

Cards should prioritize readability in this order:

1. Cover or fallback.
2. Title.
3. Authors, retaining the existing `Unknown author` fallback.
4. Featured series name and position.
5. Release year and page count.
6. Community rating and number of ratings.
7. Shelf owner's rating and read dates.

Suggested display rules:

- Series: `The Expanse #3` or `The Expanse` when position is missing.
- Multiple series: show the featured/first series and a compact `+N` indicator; keep the full list available to assistive technology or a details treatment.
- Publication facts: join available values, such as `2013 · 432 pages`.
- Community rating: `4.18 ★ · 2,431 ratings`; omit the entire line when no average exists.
- Shelf-owner rating: label it distinctly, such as `Reader rating: 4.5 ★`.
- One read date: `Read May 12, 2025`.
- Different first and last dates: `First read … · Last read …`.
- Use locale-aware number and date formatting in the UI while preserving raw numbers and ISO dates in the DTO.

Missing metadata must collapse cleanly without empty separators or placeholder labels such as `null` or `0 pages`.

### 10.5 Responsive and accessibility requirements

- Cards must remain usable at narrow mobile widths without horizontal scrolling.
- Long titles, author lists, and series names must wrap or clamp without overlapping other content.
- The Read and Want to Read tab behavior and keyboard interaction remain unchanged.
- Book links must have a visible focus state.
- Color must not be the only way information is communicated.
- Rating icons require adjacent text or an accessible label.
- The fallback must preserve sufficient text contrast for every palette color.
- The shelf's semantic list structure and accessible list name remain intact.

## 11. Security and privacy

- Continue sending the Hardcover token only from server code.
- Continue returning application DTOs rather than raw Hardcover objects.
- Continue filtering to `privacy_setting_id = 1` in the GraphQL query and validating it in the adapter.
- Do not query or persist `private_notes`.
- Treat cover URLs as untrusted strings until they pass the explicit URL allowlist.
- Do not enable broad remote image patterns, local-IP image fetching, or SVG support.
- Encode the slug path segment before building a Hardcover link.
- Do not inject titles, author names, or series names as HTML.

## 12. Error and fallback behavior

| Condition | Required behavior |
| --- | --- |
| No cover | Show deterministic colored fallback. |
| Invalid or disallowed cover URL | Store no cover and show fallback. |
| Cover request fails in browser | Reveal fallback without breaking the card. |
| Missing slug | Render the card without a Hardcover link. |
| Missing series | Omit series line. |
| Missing year or pages | Show only the available publication fact. |
| Missing community rating | Omit community rating line. |
| Zero rating count | Format as zero only when an average is actually present; otherwise omit. |
| Missing user rating | Omit reader-rating line. |
| Missing read dates | Omit read-date line. |
| Hardcover sync fails | Preserve and continue showing the previous complete snapshot. |
| Server DTO is malformed | Show the existing safe unexpected-response error. |

## 13. Test plan

### 13.1 Hardcover adapter tests

Add coverage for:

- The expanded GraphQL selection without edition or ISBN fields.
- Complete mapping of cover, slug, series, publication, community, and reader metadata.
- `book.rating` and `user_books.rating` mapping to distinct properties.
- Numeric rating values and numeric-string normalization.
- Null optional metadata.
- Cover URL protocol and hostname allowlisting.
- Missing or invalid image dimensions.
- Multiple series, featured-first ordering, deduplication, fractional positions, and invalid relationships.
- ISO read dates and null dates.
- Existing pagination, privacy, status, duplicate-book, author, and malformed-core-data behavior.

### 13.2 Database and repository tests

Add coverage for:

- The new migration on an empty database.
- The new migration on a database that already has the initial schema and book rows.
- Defaults for existing rows.
- Shared metadata persisted on `books`.
- Reader metadata persisted separately for two profiles sharing one book.
- Metadata changes and nulls replacing previous values on refresh.
- Series JSON round-tripping.
- Atomic rollback retaining the previous complete metadata snapshot.
- Idempotent repeated synchronization.

### 13.3 API and client contract tests

Add coverage for:

- Complete enriched DTOs on both shelves.
- All nullable values represented explicitly.
- Empty series represented as `[]`.
- Client rejection of malformed cover, series, rating, count, or date fields.
- Existing cached-first, first-sync, refresh, and safe-error behavior.

### 13.4 Component tests

Add coverage for:

- Canonical cover rendering.
- Accessible card/link naming without duplicated cover alt text.
- Correct Hardcover link from an encoded slug.
- Colored fallback for missing, disallowed, and failed covers.
- Title and multiple/unknown authors.
- Series name and integer/fractional position.
- Multiple-series indicator.
- Release year and pages independently and together.
- Community rating/count formatting.
- Reader rating distinct from community rating.
- First-only, last-only, same, and different read dates.
- No empty separators when optional fields are absent.
- Stable responsive grid and focus styles.
- Existing tab and refresh interactions.

### 13.5 Verification commands

Run, at minimum:

```sh
npm run typecheck
npm test
npm run build
```

Use focused Vitest invocations during development, then run the complete commands before handoff.

## 14. Implementation order

Implement in this sequence so every layer has a stable contract:

1. Expand mocked Hardcover fixtures and adapter tests.
2. Extend the GraphQL query, response schema, and `PublicShelfBook` normalization.
3. Extend the Drizzle schema and generate the migration.
4. Update repository writes and reads.
5. Extend server and client DTO types and validation.
6. Add exact Next.js remote image configuration.
7. Replace `BookSpine` with the cover-led `BookCard` presentation.
8. Update the shelf grid and responsive styles.
9. Update route, component, CSS, database, and deployment tests.
10. Run type checking, the full test suite, and the production build.
11. Perform a live synchronization against a public profile and inspect examples with complete and missing metadata.

Do not begin edition work as part of any step above.

## 15. Acceptance criteria

The feature is complete when:

- [x] A successful synchronization stores all agreed non-edition metadata.
- [x] The Hardcover query contains no edition or ISBN selection.
- [x] Existing databases migrate without losing snapshots.
- [x] Shared book metadata is stored on `books`.
- [x] Reader rating and dates are stored on `profile_books`.
- [x] Cached loads do not contact Hardcover.
- [x] Refresh remains atomic and preserves stale data on failure.
- [x] Books with valid canonical covers display those covers.
- [x] Missing, invalid, and failed covers display accessible colored fallbacks.
- [x] Cards display the agreed metadata without confusing community and reader ratings.
- [x] Valid slugs link to the corresponding Hardcover book page.
- [x] The bookshelf remains accessible and responsive.
- [x] Cover URLs are restricted to explicitly allowed HTTPS Hardcover assets.
- [x] Server and browser contracts reject malformed data safely.
- [x] Type checking, all tests, and the production build pass.
- [x] Edition-specific data, ISBNs, and edition tables are absent from the change.

## 16. Deferred edition design notes

These notes prevent the present schema from blocking future edition work:

- A future `editions` table should use Hardcover edition ID as its primary key.
- ISBNs should be nullable edition attributes and optional indexes, never the primary identity.
- A selected edition belongs to `profile_books`, because different profiles can select different editions of the same book.
- Edition cover, format, language, publisher, pages, and release date should remain separate from the canonical book fields introduced here.
- The canonical book cover remains a valid fallback when a future selected edition has no cover.

No edition table, edition relationship, or ISBN column should be created until that separate feature is approved.

## 17. References

- [Hardcover Books schema](https://github.com/hardcoverapp/hardcover-docs/blob/main/src/content/docs/api/GraphQL/Schemas/Books.mdx)
- [Hardcover Editions schema](https://github.com/hardcoverapp/hardcover-docs/blob/main/src/content/docs/api/GraphQL/Schemas/Editions.mdx)
- [Hardcover complete GraphQL schema](https://github.com/hardcoverapp/hardcover-docs/blob/main/schema.graphql)
- `node_modules/next/dist/docs/01-app/03-api-reference/02-components/image.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/images.md`
- `docs/IMPLEMENTATION_GUIDE.md`
