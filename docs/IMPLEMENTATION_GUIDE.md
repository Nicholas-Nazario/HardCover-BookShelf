# Hardcover Shelf PoC Implementation Guide

This document is the implementation reference for the first proof of concept of Hardcover Shelf. It records the agreed architecture, delivery order, API boundaries, data model, acceptance criteria, and deferred work.

> This document preserves the original PoC decisions. The implemented [Book Metadata and Covers feature](./BOOK_METADATA_AND_COVERS.md) supersedes the original spine-only and no-cover UI decisions while preserving the server-only, cached-first, atomic snapshot architecture. Edition and ISBN work remains deferred.

The immediate goal is to validate that a public Hardcover profile can be found by username, synchronized using one server-owned Hardcover token, stored locally, and rendered as two simple virtual bookshelves.

## Implementation progress

| Checkpoint | Status | Completed |
| --- | --- | --- |
| 1. Profile validation | Complete | 2026-08-17 |
| 2. SQLite and library synchronization | Complete | 2026-08-17 |
| 3a. Lightweight data interface | Complete | 2026-08-17 |
| 3b. Functional shelf page | Complete | 2026-08-17 |
| 3c. Visual bookshelf | Complete | 2026-08-17 |
| 3d. Refresh and resilience | Complete | 2026-08-17 |
| 4. Fly.io deployment framework | Complete — live deployment deferred | 2026-08-17 |
| 5. Book metadata and canonical covers | Complete | 2026-08-17 |

## 1. Product goal

A visitor enters a public Hardcover username, such as `adam` or `@adam`. The application finds that public profile, loads its public books, and presents two tabs:

- **Read**: books with Hardcover status `3`
- **Want to Read**: books with Hardcover status `1`

Each tab contains simple rows of colored book spines. Every spine displays:

```text
{title} by {author}
```

This phase validates the data integration and basic shelf metaphor. The polished, screenshot-worthy interface is a separate future design stage.

## 2. Delivery checkpoints

Implementation must proceed in the following order.

### Checkpoint 1: Profile validation

Build only the backend foundation and public-profile validation flow. Do not add SQLite or fetch book libraries yet.

At this checkpoint, the application must be able to:

1. Accept a Hardcover username.
2. Normalize and validate the input.
3. Query Hardcover from server-only code.
4. Distinguish a public profile, private profile, missing profile, and upstream failure.
5. Return a small, application-owned profile response.

Stop and check in before beginning Checkpoint 2.

### Checkpoint 2: SQLite and library synchronization

After profile validation is approved:

1. Add SQLite and migrations.
2. Fetch public `Read` and `Want to Read` books.
3. Persist a complete profile snapshot transactionally.
4. Serve cached snapshots on later requests.
5. Support an explicit synchronous refresh.

Stop and validate the stored data and API responses before building any UI.

### Checkpoint 3a: Lightweight data interface

After the data model is approved:

1. Add the username entry page.
2. Load a cached snapshot or synchronously import it when none exists.
3. Show the application-owned profile and books response as readable text or formatted JSON.
4. Add only the loading and error handling needed to exercise that flow.

This checkpoint is a diagnostic interface for the completed backend. Do not add the shelf route, tabs, book spines, visual polish, or the full state model yet.

### Checkpoint 3b: Functional shelf page

After the lightweight data flow is approved:

1. Navigate from the username form to a dedicated profile shelf route.
2. Reuse the cached-first synchronization flow on that route.
3. Display profile metadata and shelf counts.
4. Add keyboard-operable `Read` and `Want to Read` tabs.
5. Render the selected shelf as a plain text list of titles and authors.

### Checkpoint 3c: Visual bookshelf

After the functional shelf route is approved:

1. Replace plain book lists with deterministic colored book spines.
2. Arrange spines in wrapping shelf rows.
3. Complete multiple-author and missing-author display behavior.
4. Add empty-shelf presentation.
5. Make the bookshelf usable on narrow screens.

### Checkpoint 3d: Refresh and resilience

After the visual shelf is approved:

1. Add explicit synchronous refresh behavior.
2. Keep the existing shelf visible while refreshing.
3. Preserve and display the previous snapshot when refresh fails.
4. Complete the loading, private, not-found, unavailable, empty, and stale-data states.
5. Perform the final accessibility, keyboard, focus, and responsive verification.

### Checkpoint 4: Fly.io deployment

After the PoC works locally:

1. Add the production Dockerfile and `fly.toml`.
2. Create and mount a Fly Volume.
3. Run SQLite migrations at container startup.
4. Configure the Hardcover token with Fly Secrets.
5. Deploy one Machine in one region.
6. Verify that data survives a restart and redeploy.

## 3. Decisions already made

| Area | PoC decision |
| --- | --- |
| Application | Next.js with TypeScript and the App Router |
| Runtime | Node.js |
| Deployment | One Dockerized Fly.io Machine |
| Database | SQLite on a Fly Volume |
| Database access | Drizzle ORM with `better-sqlite3` |
| Authentication | None |
| Hardcover credential | One server-owned token from the developer's account |
| Profiles | Public Hardcover profiles only |
| Synchronization | Synchronous, request-bound imports |
| Background jobs | None |
| Main statuses | Want to Read (`1`) and Read (`3`) |
| Styling | Plain CSS; no design system required for the PoC |
| Book colors | Deterministic palette selection based on Hardcover book ID |
| Image covers | Not used in the PoC |

## 4. Explicit non-goals

The following are not part of this PoC:

- Application accounts or login
- Per-user Hardcover API tokens
- Private or follower-only profiles
- Hardcover mutations
- Updating reading progress or statuses
- Currently Reading, Paused, Did Not Finish, or Ignored shelves
- Scheduled synchronization
- Queues, Redis, or background workers
- PostgreSQL
- Multiple Fly Machines or regions
- Cover images
- User-controlled shelf themes or layouts
- Screenshot export or public sharing tools
- The final visual design
- Native iOS development

These can be reconsidered only after the PoC validates the data flow.

## 5. Architecture

```text
Browser
   |
   | username or shelf request
   v
Next.js application on one Fly Machine
   |
   |-- server-only Hardcover adapter
   |       |
   |       `--> https://api.hardcover.app/v1/graphql
   |
   `-- Drizzle / better-sqlite3
           |
           `--> /data/hardcover-shelf.db on a Fly Volume
```

All Hardcover requests originate from the Next.js server. The browser never receives or uses the Hardcover token.

The application exposes narrow endpoints for its own use. It must not expose a generic GraphQL proxy or accept GraphQL documents from visitors.

## 6. Suggested project structure

```text
src/
  app/
    api/
      profiles/
        [username]/
          validate/
            route.ts
          sync/
            route.ts
          books/
            route.ts
    shelf/[username]/
      page.tsx
    page.tsx
    globals.css
  components/
    bookshelf-tabs.tsx
    book-spine.tsx
    profile-search-form.tsx
  db/
    client.ts
    schema.ts
    migrate.ts
  server/
    env.ts
    hardcover/
      client.ts
      errors.ts
      profile.ts
      library.ts
      queries.ts
      types.ts
    profiles/
      repository.ts
      sync.ts
  shared/
    usernames.ts
    shelf-colors.ts
drizzle/
data/
Dockerfile
fly.toml
docker-entrypoint.sh
.env.example
```

The exact filenames may change during implementation, but the dependency direction should remain:

```text
UI and route handlers -> application services -> Hardcover adapter / repository
```

Database code and Hardcover response shapes must not leak directly into UI components.

## 7. Environment configuration

The application needs these variables:

```dotenv
HARDCOVER_API_TOKEN=
HARDCOVER_API_URL=https://api.hardcover.app/v1/graphql
DATABASE_URL=file:./data/hardcover-shelf.db
```

Production uses:

```dotenv
DATABASE_URL=file:/data/hardcover-shelf.db
```

Requirements:

- Commit `.env.example` without a token value.
- Ignore `.env`, `.env.local`, database files, WAL files, and shared-memory files.
- Never prefix the token with `NEXT_PUBLIC_`.
- Parse and validate environment variables in one server-only module.
- Fail with a clear server configuration error when the token is absent.
- Never log the token or the full `Authorization` header.

## 8. Hardcover integration rules

### Endpoint and headers

Send GraphQL requests to:

```text
https://api.hardcover.app/v1/graphql
```

Server requests should include:

```text
Authorization: Bearer <token>
Content-Type: application/json
User-Agent: Hardcover Shelf PoC
```

The adapter should use a request timeout below Hardcover's documented 30-second query timeout.

### API constraints to design around

- The API is in beta and may change.
- Tokens must remain in backend code.
- The documented rate limit is 60 requests per minute.
- Queries have a maximum depth of 3.
- Queries have a maximum execution time of 30 seconds.
- The shared token can potentially perform account-level actions, so the PoC must contain no mutation operations.
- The shared token may be able to see profiles followed by the developer's account. The application must independently enforce public-only access.

### GraphQL documents

GraphQL documents must be constants owned by the Hardcover adapter. Variables are allowed; visitor-supplied query documents are not.

Keep a small DTO layer between Hardcover and the rest of the application so schema changes are handled in one place.

## 9. Checkpoint 1 implementation: profile validation

### Username normalization

Create a shared normalization function that:

1. Trims whitespace.
2. Accepts a username, `@username`, or a supported Hardcover profile URL.
3. Removes the leading `@`.
4. Extracts the username from URLs such as `https://hardcover.app/@adam`.
5. Case-folds for lookup and caching while preserving the canonical username returned by Hardcover.
6. Rejects empty, malformed, or unreasonably long input before contacting Hardcover.

Do not interpolate the username into a GraphQL document. Always pass it as a variable.

### Profile query

The initial query should request only fields needed for validation:

```graphql
query PublicProfile($username: citext!) {
  users(where: { username: { _eq: $username } }, limit: 1) {
    id
    username
    name
    books_count
    account_privacy_setting_id
  }
}
```

Hardcover documents the profile privacy values as:

- `1`: Public
- `2`: Followers
- `3`: Private

Only value `1` is valid for this application.

### Validation endpoint

Implement:

```text
GET /api/profiles/{username}/validate
```

A successful response should be an application-owned shape:

```json
{
  "status": "public",
  "profile": {
    "id": 1,
    "username": "adam",
    "displayName": "Adam",
    "booksCount": 500
  }
}
```

Do not return the raw Hardcover response.

### Validation outcomes

| Situation | HTTP result | Application result |
| --- | --- | --- |
| Public profile | `200` | Public profile DTO |
| Private or followers-only profile | `403` | Stable `PROFILE_NOT_PUBLIC` error |
| Username not found | `404` | Stable `PROFILE_NOT_FOUND` error |
| Invalid local input | `400` | Stable `INVALID_USERNAME` error |
| Hardcover rejects the server token | `503` | Stable server configuration/upstream-auth error |
| Hardcover rate limit | `503` | Stable temporary-unavailable error; do not expose raw response |
| Timeout, GraphQL failure, or upstream `5xx` | `502` | Stable `HARDCOVER_UNAVAILABLE` error |

### Checkpoint 1 tests

At minimum, test:

- Plain username normalization
- Leading `@` normalization
- Hardcover profile URL normalization
- Invalid username rejection without an upstream call
- Public profile parsing
- Private profile rejection
- Empty user result handling
- GraphQL error handling
- Timeout and non-JSON response handling
- Authorization and token redaction in errors/logs

Mock the upstream API in automated tests. A real-token smoke test should be opt-in and never run automatically in CI.

### Checkpoint 1 acceptance criteria

- [x] Next.js application runs locally.
- [x] Hardcover client exists only in server code.
- [x] Token is loaded from a server environment variable.
- [x] A known public username validates successfully.
- [x] `@username` and a Hardcover profile URL work.
- [x] A missing profile returns the documented application error.
- [x] A non-public profile is not returned.
- [x] No SQLite dependency or database code has been added yet.
- [x] Tests for normalization, parsing, and failures pass.
- [x] Implementation stops for review before Checkpoint 2.

## 10. Checkpoint 2 implementation: SQLite

### SQLite library

Use Drizzle ORM with `better-sqlite3`. Open one database connection per Node process and reuse it.

At connection startup, configure:

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

The PoC must run as one process on one Machine. SQLite allows one writer at a time; keep transactions short and do not perform network calls inside a write transaction.

### Initial schema

#### `profiles`

| Column | Type | Notes |
| --- | --- | --- |
| `hardcover_user_id` | integer | Primary key |
| `username` | text | Unique, case-insensitive lookup |
| `display_name` | text nullable | Hardcover display name |
| `books_count` | integer | Informational |
| `privacy_setting_id` | integer | Must be `1` for stored shelves |
| `last_synced_at` | text nullable | UTC ISO timestamp |
| `created_at` | text | UTC ISO timestamp |
| `updated_at` | text | UTC ISO timestamp |

#### `books`

| Column | Type | Notes |
| --- | --- | --- |
| `hardcover_book_id` | integer | Primary key |
| `title` | text | Required display title |
| `authors_json` | text | JSON array of author names |
| `updated_at` | text | UTC ISO timestamp |

#### `profile_books`

| Column | Type | Notes |
| --- | --- | --- |
| `hardcover_user_id` | integer | Foreign key to `profiles` |
| `hardcover_book_id` | integer | Foreign key to `books` |
| `hardcover_user_book_id` | integer | Hardcover relationship ID |
| `status_id` | integer | PoC permits only `1` and `3` |

Use `(hardcover_user_id, hardcover_book_id)` as the primary key. Index `(hardcover_user_id, status_id)` for shelf queries.

### Migration behavior

- Keep versioned migrations in the repository.
- Development may use `./data/hardcover-shelf.db`.
- Production must use `/data/hardcover-shelf.db`.
- Run migrations from the container startup entrypoint before starting Next.js.
- Migrations must be safe to run repeatedly.
- Do not use a Fly release command for SQLite migrations because the release Machine does not own the mounted application volume.

## 11. Checkpoint 2 implementation: library synchronization

### Status mapping

```ts
const WANT_TO_READ_STATUS = 1;
const READ_STATUS = 3;
```

Keep these named constants in the Hardcover adapter or domain layer. UI code should use domain shelf names rather than raw status numbers.

### Library query

Fetch only public entries for the validated public user and only the two required statuses. Start with a page size of 50 and tune only if needed.

The intended query shape is:

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
    book {
      id
      title
      contributions {
        author {
          name
        }
      }
    }
  }
}
```

Validate this exact shape against the live API during Checkpoint 2. If the depth restriction rejects the nested authors, split author retrieval into a second shallow, batched query rather than broadening the adapter or returning incomplete raw data.

Pagination ends when a page returns fewer rows than the requested limit.

### Author handling

- Preserve authors as an array in the domain DTO and SQLite JSON column.
- Remove null or blank names.
- Deduplicate repeated names while retaining API order.
- Display multiple authors joined with `, `.
- Display `Unknown author` when no usable author is returned.

### Synchronous sync flow

Implement:

```text
POST /api/profiles/{username}/sync
```

The flow is:

1. Normalize the username.
2. Validate the profile again with Hardcover.
3. Reject the profile unless it is public.
4. Fetch all pages of status `1` and `3` books into memory.
5. Validate and map the entire response to domain objects.
6. Begin a short SQLite transaction.
7. Upsert the profile.
8. Upsert all fetched books.
9. Replace that profile's `profile_books` rows.
10. Update `last_synced_at`.
11. Commit.
12. Return shelf counts and synchronization time.

Never hold the SQLite transaction open while making Hardcover requests.

If any upstream page fails, do not replace an existing snapshot. Return an error and leave the last good data intact.

### Concurrent imports

Use an in-process map of normalized username to active synchronization promise. If the same username is requested concurrently, all callers should await the existing promise rather than issuing duplicate Hardcover requests.

The database transaction remains the final consistency boundary if the process restarts.

### Read endpoint

Implement:

```text
GET /api/profiles/{username}/books
```

Return only application DTOs:

```json
{
  "profile": {
    "username": "adam",
    "displayName": "Adam",
    "lastSyncedAt": "2026-08-17T12:00:00.000Z"
  },
  "shelves": {
    "read": [
      {
        "id": 123,
        "title": "Example Book",
        "authors": ["Example Author"]
      }
    ],
    "wantToRead": []
  }
}
```

Return `404` when no cached snapshot exists. The browser may then offer or initiate the synchronous import.

### Checkpoint 2 tests

At minimum, test:

- Pagination across multiple pages
- Status `1` and `3` mapping
- Exclusion of all other statuses
- Public-entry filtering
- Multiple-author mapping
- Missing-author fallback
- Duplicate-author removal
- SQLite migration from an empty database
- Transactional snapshot replacement
- Preservation of an old snapshot after an upstream failure
- Idempotent repeat synchronization
- Concurrent import deduplication
- Read shelf and Want to Read shelf API responses

Use a temporary SQLite database for each test suite. Do not write tests against the developer's local database.

### Checkpoint 2 acceptance criteria

- [x] SQLite persists profiles, books, and shelf relationships.
- [x] Only public status `1` and `3` entries are stored.
- [x] A profile with more than one API page synchronizes completely.
- [x] Repeat synchronization does not duplicate books.
- [x] Failed synchronization retains the last good snapshot.
- [x] Read endpoint returns stable application DTOs.
- [x] Database and integration tests pass.
- [x] Implementation stops for data review before Checkpoint 3a.

## 12. Checkpoint 3 implementation

### Checkpoint 3a: lightweight data interface

Checkpoint 3a exists only to make the Checkpoint 2 backend usable from the browser. It should remain intentionally plain and small.

#### Route

```text
/    Username entry and data-response page
```

Do not add `/shelf/{username}` during Checkpoint 3a.

#### Page requirements

The home page needs only:

- Product name and a short description
- One username/profile URL input
- One submit button
- A short public-profile limitation notice
- A visible loading message while a first synchronization is running
- A readable rendering of the application-owned cached-books DTO, such as formatted JSON in a `<pre>` element
- A concise inline error for invalid, missing, non-public, and unavailable profiles

On submit:

1. Normalize the input through the existing API boundary.
2. Request `GET /api/profiles/{username}/books`.
3. If the snapshot exists, display it without contacting Hardcover.
4. If it returns `SNAPSHOT_NOT_FOUND`, visibly wait while calling `POST /api/profiles/{username}/sync`.
5. Request the cached books again and display the resulting application DTO.

The page must not receive the Hardcover token, raw Hardcover response shapes, or raw database rows. It may display the existing application DTO without transforming it into a visual shelf.

#### Explicitly deferred beyond Checkpoint 3a

- A separate shelf route and Read/Want to Read tabs until Checkpoint 3b
- Book-spine components, colors, dimensions, and shelf styling until Checkpoint 3c
- Explicit refresh controls and the complete stale-data state model until Checkpoint 3d
- Responsive visual verification beyond keeping the diagnostic output usable

#### Checkpoint 3a tests

- Username form submission
- Cached response rendering without synchronization
- First-load synchronization after `SNAPSHOT_NOT_FOUND`
- Visible loading state during synchronization
- Read and Want to Read arrays appear in the rendered application response
- Invalid, missing, private, and unavailable profile errors

#### Checkpoint 3a acceptance criteria

- [x] A visitor can enter a public Hardcover username from the home page.
- [x] An existing snapshot is displayed without a Hardcover request.
- [x] A missing snapshot triggers a visible synchronous import.
- [x] The resulting application-owned books response is readable in the browser.
- [x] Failures are shown without exposing raw upstream or database data.
- [x] No shelf-specific visual components are introduced.
- [x] Implementation stops for review before Checkpoint 3b.

### Checkpoint 3b: functional shelf page

#### Routes

```text
/                    Username entry page
/shelf/{username}    Shelf page
```

The input may still accept `@username` and a full Hardcover profile URL. A prettier application URL can be considered after the PoC; do not distort the App Router structure solely for a decorative URL.

Checkpoint 3b may reuse and refine the Checkpoint 3a entry form. Navigation from that form should move the visitor to the dedicated shelf route.

#### Entry page

The refined home page needs:

- Product name
- One username/profile URL input
- Submit button
- Short public-profile limitation notice
- Inline validation errors

On submit:

1. Navigate to the shelf route.
2. Request the cached snapshot.
3. If it does not exist, show a loading state and synchronously call the sync endpoint.
4. Load the new snapshot after synchronization completes.

#### Functional shelf page

Display:

- Canonical username and optional display name
- Last-synchronized time
- `Read` and `Want to Read` tabs with counts
- One visible shelf at a time
- A plain list of `{title} by {authors}` rows for the selected shelf

The default tab is `Read`.

Do not add book-spine shapes, shelf colors, variable dimensions, or explicit refresh controls during Checkpoint 3b.

#### Tabs

Use semantic buttons with appropriate tab roles, arrow-key operation, focus styles, and selected state. Basic accessibility belongs with the introduction of the tabs and must not be postponed.

#### Required states

- Navigating from the username form
- Loading an existing cached shelf
- Building a first shelf synchronously
- Displaying a cached shelf
- Profile not found
- Profile not public
- Hardcover unavailable during the first import

Empty-shelf presentation remains deferred to Checkpoint 3c. Refresh-specific states remain deferred to Checkpoint 3d.

#### Checkpoint 3b tests

- Username form navigation
- Shelf-route username handling
- Cached load without synchronization
- First-load synchronization state
- Profile metadata and counts
- Read tab rendering
- Want to Read tab rendering
- Correct `{title} by {authors}` text
- Multiple-author display
- Private and missing profile states
- Keyboard tab selection

#### Checkpoint 3b acceptance criteria

- [x] A visitor can navigate from the home page to `/shelf/{username}`.
- [x] An existing snapshot loads without a Hardcover request.
- [x] A first-time profile import visibly waits for synchronous completion.
- [x] Canonical profile information and both shelf counts are shown.
- [x] Read and Want to Read books appear as plain text under accessible tabs.
- [x] Tabs support pointer and keyboard operation.
- [x] Basic first-load failures are displayed without leaking internal data.
- [x] No book-spine visualization or explicit refresh control is introduced.
- [x] Implementation stops for review before Checkpoint 3c.

### Checkpoint 3c: visual bookshelf

Checkpoint 3c changes presentation, not data-loading behavior. It retains the functional route, tabs, and cached-first flow approved in Checkpoint 3b.

#### Book spines

Each book is a simple rectangular spine. Requirements:

- Show `{title} by {authors}` on every spine.
- Use a small fixed palette with sufficient text contrast.
- Choose the palette index with a stable hash of the Hardcover book ID.
- Do not use `Math.random()` during render; colors must not change after hydration or between visits.
- Minor deterministic width or height differences are allowed but not required.
- Use an accessible label containing the full title and authors.

The initial design should favor legibility and data validation over realism.

#### Shelf layout

- Render spines in rows that wrap based on available width.
- Align books to the bottom of each row.
- Retain the accessible tab semantics established in Checkpoint 3b.
- Keep the shelf usable without animation.
- Ensure titles remain legible on desktop and narrow screens.

#### Author and empty-shelf display

- Join multiple authors with `, `.
- Display `Unknown author` when the authors array is empty.
- Show a clear empty state when the selected shelf has no books.

#### Checkpoint 3c tests

- Read and Want to Read spine rendering
- Correct `{title} by {authors}` spine text
- Multiple-author and `Unknown author` display
- Stable book colors across renders
- Empty Read and Want to Read shelf states
- Accessible full-title labels
- Narrow-screen layout does not require horizontal page scrolling

#### Checkpoint 3c acceptance criteria

- [x] Plain book lists are replaced by visual book spines.
- [x] Every spine displays its title and author information.
- [x] Book colors remain stable across renders and reloads.
- [x] Read and Want to Read shelves retain accessible tab behavior.
- [x] Empty shelves have a clear presentation.
- [x] The bookshelf remains usable on a narrow viewport.
- [x] No refresh workflow is introduced.
- [x] Implementation stops for review before Checkpoint 3d.

### Checkpoint 3d: refresh and resilience

Checkpoint 3d completes the local interface behavior before deployment work begins.

#### Refresh flow

- Add an explicit Refresh button to the shelf page.
- Keep the cached shelf visible while the synchronous refresh runs.
- Disable duplicate refresh submissions for the same visible shelf.
- Replace the displayed shelf only after the refresh succeeds and the new cached DTO is loaded.
- If refresh fails, retain the old shelf and show a concise non-destructive error.

#### Complete required states

- Initial username form
- Building shelf/loading
- Cached shelf
- Refreshing shelf
- Empty Read shelf
- Empty Want to Read shelf
- Profile not found
- Profile not public
- Hardcover unavailable
- Refresh failed while an older snapshot remains available

#### Final accessibility and responsive review

- Verify semantic headings, form labels, tab roles, accessible names, focus order, and visible focus styles.
- Verify keyboard operation for the form, tabs, and Refresh button.
- Verify status and error announcements do not replace useful cached content.
- Verify the complete interface on desktop and a narrow mobile viewport.

#### Checkpoint 3d tests

- Successful explicit refresh
- Refreshing state with the old shelf still visible
- Duplicate-refresh prevention
- Refresh failure with the old snapshot retained
- Updated counts and books after a successful refresh
- Remaining private, missing, unavailable, empty, and stale-data states
- Keyboard and focus behavior
- Desktop and narrow-viewport verification

#### Checkpoint 3d acceptance criteria

- [x] Refresh runs synchronously and updates the visible shelf on success.
- [x] The previous shelf stays visible throughout refresh.
- [x] Refresh failure retains the last good shelf and explains the failure.
- [x] All required loading, empty, private, missing, unavailable, and stale-data states are covered.
- [x] The complete interface is keyboard accessible with visible focus states.
- [x] The complete interface works on desktop and a narrow mobile viewport.
- [x] Implementation stops for review before Checkpoint 4.

## 13. Checkpoint 4 implementation: Fly.io

### Container

Use a multi-stage Dockerfile and Next.js standalone output:

```ts
const nextConfig = {
  output: "standalone",
};
```

The production image must contain:

- Next.js standalone server output
- `.next/static`
- `public`
- Production dependencies required by `better-sqlite3`
- Drizzle migration files
- SQLite startup/migration script

The server must listen on `0.0.0.0` and the port configured by Fly.

### Volume

Create one volume in the same region as the Machine and mount it at `/data`:

```toml
[mounts]
  source = "hardcover_data"
  destination = "/data"
  initial_size = "1gb"
```

Keep the application at exactly one Machine. Fly Volumes are local to a Machine and are not shared or automatically replicated.

### Machine lifecycle

For the PoC:

```toml
[http_service]
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0
```

The first request after idle time may experience a cold start. This is acceptable.

Profile synchronization must keep its HTTP request open until the import succeeds or fails. Do not start detached work after returning the response.

### Secrets

Set the token using Fly Secrets:

```sh
fly secrets set HARDCOVER_API_TOKEN="..."
```

Set non-secret production configuration in `fly.toml`, including:

```toml
[env]
  DATABASE_URL = "file:/data/hardcover-shelf.db"
  HARDCOVER_API_URL = "https://api.hardcover.app/v1/graphql"
```

### Deployment verification

- [ ] Container builds without the local `.env` file.
- [ ] Startup migration succeeds against the mounted database.
- [ ] Known public profile validation works in production.
- [ ] First shelf import completes in one HTTP request.
- [ ] Cached shelf loads without another Hardcover request.
- [ ] SQLite data survives a Machine restart.
- [ ] SQLite data survives a new application deploy.
- [ ] Autostop and autostart work with the mounted volume.
- [ ] Logs contain no token or authorization header.

## 14. Logging and diagnostics

Use structured server logs with:

- Request or operation ID
- Normalized public username
- Hardcover operation name, not the full GraphQL document
- Request duration
- Page number during library pagination
- Returned book count
- Sync result and duration
- Stable application error code

Never log:

- The Hardcover token
- Authorization headers
- Full upstream request headers
- Unfiltered upstream responses

The profile sync response may include counts and timing, but not internal errors or raw GraphQL errors.

## 15. Performance expectations for the PoC

No aggressive optimization is required, but implementation should preserve these properties:

- Cached shelves read only from local SQLite.
- No Hardcover request occurs for a normal cached page load.
- Network fetches happen before the SQLite write transaction.
- Pagination is sequential unless testing shows controlled concurrency is safe under the shared rate limit.
- Only one synchronization runs per username at a time.
- The UI does not render cover images or expensive effects.
- Book colors are computed locally without extra network requests.

## 16. Security and privacy checklist

- [ ] Hardcover token is server-only.
- [ ] No generic GraphQL proxy exists.
- [ ] No Hardcover mutation documents exist.
- [ ] Profile privacy is checked explicitly.
- [ ] User-book privacy is filtered explicitly.
- [ ] Only fields needed for the PoC are requested and stored.
- [ ] Inputs use GraphQL variables rather than string interpolation.
- [ ] Username input is length- and format-limited.
- [ ] Upstream responses are parsed and validated before use.
- [ ] Errors do not reveal the token or raw upstream details.
- [ ] New-username validation and sync endpoints receive basic IP throttling before public release.

## 17. PoC definition of done

The proof of concept is complete when:

1. The application is deployed to Fly.io as one Next.js Machine.
2. SQLite persists on a mounted Fly Volume.
3. A visitor can enter a public Hardcover username.
4. The application validates that profile using the server-owned token.
5. The first library import runs synchronously while the visitor sees a loading state.
6. Only public Read and Want to Read books are stored.
7. Later visits load the cached snapshot from SQLite.
8. Two accessible tabs display the Read and Want to Read shelves.
9. Each shelf renders simple, consistently colored spines with `{title} by {author}`.
10. A refresh failure does not destroy the last good shelf.
11. The token never reaches the browser or logs.

## 18. Deferred migration path

If the PoC succeeds, the likely progression is:

1. Conduct the separate visual design stage.
2. Add cover imagery, richer shelf layout, animation, and screenshot mode.
3. Move SQLite to PostgreSQL when multiple Machines, accounts, or valuable user-created state require it.
4. Move synchronization to a queue and worker when request-bound imports become too slow.
5. Introduce a dedicated Hardcover service account before wider public release.
6. Add application accounts only when persistent customization or private data requires them.
7. Expose a stable application API for a future iOS client.

The UI and application services should depend on domain DTOs rather than Drizzle rows or Hardcover GraphQL types so these migrations remain contained.

## 19. Primary references

- [Hardcover API Getting Started](https://github.com/hardcoverapp/hardcover-docs/blob/main/src/content/docs/api/Getting-Started.mdx)
- [Hardcover Users schema and username lookup](https://github.com/hardcoverapp/hardcover-docs/blob/main/src/content/docs/api/GraphQL/Schemas/Users.mdx)
- [Hardcover User Books schema and status IDs](https://github.com/hardcoverapp/hardcover-docs/blob/main/src/content/docs/api/GraphQL/Schemas/UserBooks.mdx)
- [Hardcover books-by-status guide](https://github.com/hardcoverapp/hardcover-docs/blob/main/src/content/docs/api/guides/GettingBooksWithStatus.mdx)
- [Fly.io Next.js guide](https://fly.io/docs/js/frameworks/nextjs/)
- [Fly.io SQLite guide](https://fly.io/docs/js/prisma/sqlite/)
- [Fly.io Volumes guide](https://fly.io/docs/volumes/overview/)

## 20. Decision log

### 2026-08-17

- Chose a web-first proof of concept.
- Chose Next.js and TypeScript.
- Chose one server-owned Hardcover token for public-profile access.
- Deferred a dedicated Hardcover service account until wider release.
- Restricted the PoC to public profiles and public book entries.
- Chose Fly.io for hosting.
- Chose SQLite on a single Fly Volume instead of paid managed PostgreSQL.
- Chose synchronous first-profile synchronization instead of a background worker.
- Restricted the initial shelves to Read and Want to Read.
- Deferred the full visual interface to a separate design stage.
- Split the original interface checkpoint into Checkpoint 3a, a lightweight username-and-data diagnostic UI; Checkpoint 3b, a functional shelf route with accessible tabs and plain lists; Checkpoint 3c, the visual bookshelf; and Checkpoint 3d, refresh resilience and final interface hardening.

## 21. Work completed

### 2026-08-17 — Checkpoint 1: Profile validation

- Scaffolded the Next.js and TypeScript backend service.
- Added server-only environment loading for `HARDCOVER_API_TOKEN`.
- Added username normalization for plain usernames, `@username`, and Hardcover profile URLs.
- Added `GET /api/profiles/{username}/validate`.
- Added public-profile enforcement and stable errors for invalid, missing, non-public, and unavailable profiles.
- Added mocked coverage for normalization, profile parsing, authentication failure, rate limiting, invalid responses, GraphQL errors, and timeouts.
- Passed 24 automated tests, TypeScript checking, and the Next.js production build.
- Completed a live API validation of `adam`: HTTP `200`, Hardcover user ID `1`, and `1,262` books reported at validation time.
- Confirmed that the token remained server-only and was not returned in the response or logs.

### 2026-08-17 — Checkpoint 2: SQLite and library synchronization

- Added Drizzle ORM and `better-sqlite3` with a versioned initial migration for `profiles`, `books`, and `profile_books`.
- Added a process-wide reusable SQLite connection with WAL mode, foreign keys, and a 5-second busy timeout; development defaults to `./data/hardcover-shelf.db` and production supports `/data/hardcover-shelf.db`.
- Added validated, sequential 50-record pagination for public Hardcover status `1` and `3` entries, including normalized multi-author arrays, duplicate and blank removal, and the `Unknown author` display fallback.
- Validated the intended nested contributions/author query live. Hardcover accepted it, so no second author query was required. The implementation also returns and validates each entry's privacy setting before persistence.
- Added `POST /api/profiles/{username}/sync` with complete pre-transaction fetching, atomic snapshot replacement, idempotent upserts, failure preservation, and per-normalized-username in-process promise deduplication.
- Added `GET /api/profiles/{username}/books` with the application-owned `read` and `wantToRead` DTO and a `404` response when no synchronized snapshot exists.
- Added temporary-database and mocked-upstream coverage for migrations, PRAGMAs, pagination, status/privacy filtering, author mapping, atomic replacement and rollback, page-two upstream failure preservation, idempotency, concurrent deduplication, and cached response DTOs.
- Passed 41 automated tests across 8 files, TypeScript checking, and the Next.js 16.3.1 production build.
- Completed a live synchronous import of `adam`: HTTP `200`, `1,257` Read books, and `1,006` Want to Read books. The cached endpoint and direct SQLite counts matched, and a small title/author sample was inspected without exposing the token.

### 2026-08-17 — Checkpoint 3a: Lightweight data interface

- Replaced the stale Checkpoint 1 home page with a small interactive username form while keeping the page itself as a Server Component and isolating browser state in one Client Component.
- Added the cached-first browser flow: request the books DTO, synchronously import only after `SNAPSHOT_NOT_FOUND`, then request and display the stored DTO.
- Added visible cache-checking, synchronization, and post-sync loading messages; disabled duplicate form submissions while a request is active.
- Added formatted JSON output with Read and Want to Read counts, without adding a shelf route, tabs, spines, colors, or refresh controls.
- Added local mappings for stable application error codes so raw or unexpected response messages are never rendered.
- Added focused browser-component coverage for cached loads, first synchronization, loading state, DTO rendering, invalid input, missing profiles, private profiles, and temporary Hardcover failures.
- Passed 47 automated tests across 9 files, TypeScript checking, and the Next.js 16.3.1 production build.
- Verified the development home page and cached `adam` response locally: HTTP `200`, `1,257` Read books, and `1,006` Want to Read books.

### 2026-08-17 — Checkpoint 3b: Functional shelf page

- Refined the home page into a navigation form that safely normalizes plain usernames, `@username` values, and supported Hardcover profile URLs before opening `/shelf/{username}`.
- Added the Next.js dynamic shelf page using the version 16 asynchronous `params` convention and a narrow Client Component boundary for browser-side loading and tab state.
- Moved the cached-first GET, conditional synchronous POST, and final GET flow into a reusable client API adapter with application-owned DTO validation and stable local error messages.
- Added canonical profile metadata, last-synchronized time, Read and Want to Read counts, and one visible plain-text shelf list at a time.
- Added semantic tabs with selected state, roving tab stops, pointer operation, arrow keys, Home, End, visible focus styles, and labelled tab panels.
- Added tests for normalized navigation, malformed input, cached loads, first synchronization, route username encoding, profile metadata, counts, multi-author text, pointer tabs, keyboard tabs, and safe first-load errors.
- Passed 52 automated tests across 10 files, TypeScript checking, and the Next.js 16.3.1 production build.
- Verified `/`, `/shelf/adam`, and the cached `adam` DTO locally; the stored counts remained `1,257` Read and `1,006` Want to Read.
- Stopped before Checkpoint 3c without adding book spines, deterministic shelf colors, or refresh controls.

### 2026-08-17 — Checkpoint 3c: Visual bookshelf

- Replaced the plain book rows with simple rectangular spines in wrapping, bottom-aligned shelf rows while retaining the existing `/shelf/{username}` route, cached-first flow, first-time synchronous import, profile metadata, counts, and application-owned DTO boundary.
- Added a fixed six-color high-contrast palette and stable FNV-1a-style hashing of each Hardcover book ID; colors use no randomness and remain stable across rerenders and reloads.
- Added complete visible and accessible `{title} by {authors}` labels, comma-joined multiple authors, and the `Unknown author` fallback for empty author arrays.
- Added distinct empty states for Read and Want to Read shelves and responsive constraints for wrapping, long text, tabs, and page-width containment without animation.
- Expanded component and CSS coverage for both spine shelves, exact and accessible text, multiple and missing authors, deterministic palette mapping, rerender stability, both empty states, pointer and keyboard tabs, cached-first loading, first synchronization, and narrow-layout contracts.
- Passed 60 automated tests across 12 files, TypeScript checking, and the Next.js 16.3.1 production build.
- Verified the cached `adam` shelf locally in Chromium at desktop and an emulated 390px viewport: `1,257` Read and `1,006` Want to Read spines, working pointer and keyboard tabs, complete multiple-author and missing-author labels, stable colors after reload, and no horizontal page overflow.
- Stopped before Checkpoint 3d without adding refresh controls, refreshing state, refresh-failure behavior, background work, covers, animation, or final visual polish.

### 2026-08-17 — Checkpoint 3d: Refresh and resilience

- Added an explicit shelf Refresh button that synchronously calls the existing application sync endpoint and reloads the cached application DTO only after synchronization succeeds.
- Kept the previous snapshot, counts, selected tab, and timestamp visible throughout refresh; disabled the button and guarded the handler so duplicate refresh requests cannot start.
- Added polite progress and success announcements plus an assertive, locally mapped failure message that retains and identifies the last synchronized shelf without rendering raw upstream details.
- Completed the local state coverage for initial loading, first synchronization, cached data, refreshing, both empty shelves, missing and non-public profiles, Hardcover unavailability, and stale data after refresh failure.
- Added responsive Refresh-button layout and visible keyboard focus styling while retaining the semantic tab pattern, accessible spine names, form label, headings, and focus order.
- Expanded coverage for successful refresh, visible old data during refresh, duplicate prevention, keyboard activation and focus order, updated books/counts/timestamp, refresh failure preservation, safe errors, and responsive CSS.
- Passed 64 automated tests across 12 files, TypeScript checking, and the Next.js 16.3.1 production build.
- Verified a real cached `adam` refresh locally in Chromium. The previous `1,257` Read and `1,006` Want to Read shelves remained available during synchronization, the refresh completed successfully, the timestamp advanced, and both shelf counts remained consistent.
- Verified desktop and emulated 390px layouts, both shelf tabs, keyboard focus and selection, a visible 3px focus outline, full-width mobile Refresh control, status announcements, and zero horizontal page overflow.
- Completed Checkpoint 3 and stopped before Checkpoint 4 without adding deployment files or infrastructure.

### 2026-08-17 — Checkpoint 4: Fly.io deployment framework

- Enabled the Next.js 16 standalone server output and added a multi-stage Node 22 Dockerfile containing the traced runtime, static and public assets, Drizzle migrations, the startup migrator, and the native SQLite runtime dependencies.
- Added a non-root production runtime that listens on `0.0.0.0:8080`, owns `/data`, runs versioned SQLite migrations before starting Next.js, and does not need the Hardcover credential during image construction.
- Added a Docker ignore policy that excludes local environment files, SQLite files, build output, dependencies, coverage, and logs from the image build context.
- Added Fly configuration for one primary EWR region, a 1 GB `hardcover_data` volume mounted at `/data`, server-only production environment settings, HTTP health checks, one shared CPU with 1 GB memory, and autostop/autostart with zero always-running Machines.
- Added deployment configuration tests and a startup migration integration test. The full suite now passes 69 tests across 13 files, along with TypeScript checking and the Next.js production build.
- Completed a clean production build from a source copy containing no `.env`; the standalone output also contained no `.env`.
- Assembled and ran the final standalone filesystem layout locally without any local environment file. Startup migrations created all required tables, `/api/health` and the home page returned `200`, an empty database returned `SNAPSHOT_NOT_FOUND`, and sampled static assets returned `200`.
- Installed Fly CLI `0.4.83` for future use.
- Completed the requested deployment framework and local verification. Live app creation, platform config validation, secret staging, volume creation, deployment, restart/redeploy persistence, autostop/autostart, and production log verification are intentionally deferred until a future deployment is requested.
