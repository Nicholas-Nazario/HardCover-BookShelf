# Hardcover Shelf

Hardcover Shelf is a proof-of-concept application that imports the public library of a [Hardcover](https://hardcover.app/) user and stores it as a local bookshelf snapshot.

The application currently provides a visual shelf page backed by the synchronization and persistence layer. It can:

- Validate that a Hardcover profile exists and is public.
- Import public **Read** and **Want to Read** books from Hardcover.
- Store profiles, books, and shelf relationships in SQLite.
- Serve the cached library as a small, application-owned JSON API.
- Refresh a profile from the shelf page while keeping the last good snapshot visible and intact if Hardcover fails.
- Accept a username in the browser, synchronize it when necessary, and navigate to a dedicated shelf page.
- Present Read and Want to Read books on an immersive, full-screen bookshelf with accessible tabs and compact toolbar controls.
- Render books as cover-only objects with canonical Hardcover artwork and deterministic high-contrast fallbacks.
- Reveal book metadata, ratings, reading history, series information, and an accessible Hardcover link in a modal when a cover is selected.
- Switch between configurable shelf themes and remember the selected theme in a first-party browser cookie.

Only public data is imported. The supported Hardcover statuses are:

| Shelf | Hardcover status |
| --- | ---: |
| Want to Read | `1` |
| Read | `3` |

The Book Metadata and Covers feature enriches the original PoC without changing its cached-snapshot architecture. Canonical book metadata is shared in `books`; the public shelf owner's rating and read dates remain profile-specific in `profile_books`. See [BOOK_METADATA_AND_COVERS.md](./docs/BOOK_METADATA_AND_COVERS.md) for the metadata pipeline and storage contract and [IMPLEMENTATION_GUIDE.md](./docs/IMPLEMENTATION_GUIDE.md) for the original PoC architecture. The current presentation is described below.

## Shelf experience and themes

The shelf route is a full-screen scene rather than a conventional card grid. Each book is represented by its cover alone; activating a cover opens an accessible dialog containing the book and reader metadata. The toolbar provides shelf tabs, synchronization, profile navigation, and appearance settings without introducing a separate page header.

The built-in themes are:

- **Wood - Walnut**: a warm, dark room with illustrated walnut shelves.
- **Wood - Pine**: a light, sunlit room with illustrated pine shelves.
- **Metal - Black**: a dark-mode room with clean blackened-steel shelves.

Theme definitions live in [`src/shared/shelf-themes.ts`](./src/shared/shelf-themes.ts). Each theme supplies the complete scene, material, toolbar, dialog, focus, and shadow palette through CSS custom properties. Themes can also opt into shelf overlays through `shelfOverlays`; Walnut and Pine enable the shared `wood-grain` overlay, while Metal intentionally has no shelf overlay. The grain and knots are a single transparent mask in [`public/shelf-grain.svg`](./public/shelf-grain.svg).

The selected theme is stored for one year in the `hardcover-shelf-theme` first-party cookie. The server validates the cookie and uses it for the initial render, avoiding a theme flash after navigation or reload. Missing and unrecognized values safely fall back to Wood - Walnut.

## Technology

- Next.js 16 with TypeScript and the App Router
- Drizzle ORM
- SQLite through `better-sqlite3`
- Vitest

## Run locally

### Prerequisites

- Node.js 22 or newer
- npm
- A Hardcover API token

The token is a server credential. Never expose it in browser code, prefix it with `NEXT_PUBLIC_`, print it, or commit it.

### Setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Create the local environment file:

   ```sh
   cp .env.example .env
   ```

3. Add your raw Hardcover API token to `.env`:

   ```dotenv
   HARDCOVER_API_TOKEN=your-token-here
   HARDCOVER_API_URL=https://api.hardcover.app/v1/graphql
   DATABASE_URL=file:./data/hardcover-shelf.db
   ```

   `HARDCOVER_API_URL` and `DATABASE_URL` already have suitable development defaults. Production can use `DATABASE_URL=file:/data/hardcover-shelf.db`.

4. Start the development server:

   ```sh
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000), or call one of the APIs below.

The SQLite database is created under `./data` when it is first needed. Versioned Drizzle migrations run automatically when the application opens the database. They can also be run explicitly with:

```sh
mkdir -p data
npm run db:migrate
```

SQLite is configured with WAL mode, foreign keys enabled, and a five-second busy timeout. Database files and local environment files are ignored by Git.

### Production-style local run

```sh
npm run build
npm start
```

### Fly.io deployment

The repository includes a multi-stage standalone [Dockerfile](./Dockerfile), startup migrations, and [fly.toml](./fly.toml) configured for one EWR Machine with an encrypted 1 GB volume mounted at `/data`.

When a live deployment is eventually wanted, authenticate first:

```sh
fly auth login
```

The Hardcover token must be stored only as a Fly Secret. Never put it in `fly.toml`, the Docker build arguments, or a committed file. The deployment flow creates the `hardcover_data` volume, stages `HARDCOVER_API_TOKEN`, and deploys with high availability disabled so SQLite remains attached to exactly one Machine.

### Verification

```sh
npm test
npm run typecheck
npm run build
```

Automated database tests use temporary SQLite files and do not modify `./data/hardcover-shelf.db`.

## API reference

All responses are JSON. Profile endpoints accept a case-insensitive username. A leading `@` also works when URL-encoded as `%40`, for example `%40adam`.

### Health check

```text
GET /api/health
```

Example:

```sh
curl http://localhost:3000/api/health
```

Response:

```json
{
  "status": "ok"
}
```

### Validate a public profile

```text
GET /api/profiles/{username}/validate
```

This contacts Hardcover but does not import or cache the user's books.

Example:

```sh
curl http://localhost:3000/api/profiles/adam/validate
```

Successful response:

```json
{
  "status": "public",
  "profile": {
    "id": 1,
    "username": "adam",
    "displayName": "Adam",
    "booksCount": 1262
  }
}
```

### Synchronize a profile

```text
POST /api/profiles/{username}/sync
```

This is a synchronous, request-bound import. It:

1. Normalizes the username and confirms that the profile is public.
2. Fetches every page of public Read and Want to Read entries from Hardcover.
3. Validates the complete upstream result.
4. Atomically replaces the cached shelf snapshot in SQLite.

If any Hardcover request fails, the previous cached snapshot remains unchanged. Concurrent requests for the same normalized username share one in-process synchronization promise.

Example:

```sh
curl -X POST http://localhost:3000/api/profiles/adam/sync
```

Successful response:

```json
{
  "profile": {
    "username": "adam",
    "displayName": "Adam"
  },
  "counts": {
    "read": 1257,
    "wantToRead": 1006
  },
  "lastSyncedAt": "2026-08-17T16:13:42.590Z"
}
```

Large libraries can take a while because Hardcover pages are fetched sequentially before the database transaction begins.

### Read a cached shelf

```text
GET /api/profiles/{username}/books
```

This reads only from SQLite and does not contact Hardcover. It returns `404` with `SNAPSHOT_NOT_FOUND` if the profile has not been synchronized yet.

Example:

```sh
curl http://localhost:3000/api/profiles/adam/books
```

Successful response:

```json
{
  "profile": {
    "username": "adam",
    "displayName": "Adam",
    "lastSyncedAt": "2026-08-17T16:13:42.590Z"
  },
  "shelves": {
    "read": [
      {
        "id": 123,
        "title": "Example Book",
        "authors": ["First Author", "Second Author"],
        "slug": "example-book",
        "cover": {
          "url": "https://assets.hardcover.app/covers/example.jpg",
          "width": 400,
          "height": 600
        },
        "releaseYear": 2021,
        "pages": 432,
        "communityRating": 4.18,
        "ratingsCount": 2431,
        "series": [
          {
            "id": 9,
            "name": "Example Series",
            "position": 3,
            "featured": true
          }
        ],
        "userRating": 4.5,
        "firstReadDate": "2024-01-02",
        "lastReadDate": "2025-05-12"
      }
    ],
    "wantToRead": []
  }
}
```

Every book DTO includes every metadata key. Optional values use `null`, series uses `[]`, and `ratingsCount` defaults to `0`. Authors are returned as an array; blank and duplicate names are removed while preserving source order. An empty author array displays as `Unknown author`.

Only canonical HTTPS cover URLs on `assets.hardcover.app` are retained. Missing, invalid, or browser-failed covers use the stable color derived from the Hardcover book ID. Cover requests are optimized by Next.js with lazy loading, no redirects, and an exact remote hostname allowlist.

Community averages (`communityRating`) and the shelf owner's rating (`userRating`) are deliberately distinct throughout the adapter, database, API, and UI. Hardcover book IDs remain the sole book identity; editions and ISBNs are not queried or stored.

## Errors

Errors use a stable application-owned envelope and do not include raw Hardcover or database responses:

```json
{
  "error": {
    "code": "PROFILE_NOT_FOUND",
    "message": "No Hardcover profile was found for that username."
  }
}
```

Common results are:

| HTTP status | Code | Meaning |
| ---: | --- | --- |
| `400` | `INVALID_USERNAME` | The username or path input is malformed. |
| `403` | `PROFILE_NOT_PUBLIC` | The Hardcover profile is followers-only or private. |
| `404` | `PROFILE_NOT_FOUND` | Hardcover has no matching profile. |
| `404` | `SNAPSHOT_NOT_FOUND` | No synchronized SQLite snapshot exists. |
| `502` | `HARDCOVER_UNAVAILABLE` | Hardcover failed or returned an invalid response. |
| `503` | `HARDCOVER_TEMPORARILY_UNAVAILABLE` | Hardcover timed out or rate-limited the request. |
| `503` | `SERVER_CONFIGURATION_ERROR` | A required server setting or credential is missing or invalid. |
| `500` | `INTERNAL_SERVER_ERROR` | An unexpected application failure occurred. |

The application exposes no generic GraphQL proxy and performs no Hardcover mutations.
