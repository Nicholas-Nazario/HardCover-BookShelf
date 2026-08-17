import {
  isAllowedHardcoverCoverUrl,
  isIsoDate,
} from "../shared/book-metadata";

export interface ShelfBookDto {
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

export interface ShelfSnapshotDto {
  profile: {
    username: string;
    displayName: string | null;
    lastSyncedAt: string;
  };
  shelves: {
    read: ShelfBookDto[];
    wantToRead: ShelfBookDto[];
  };
}

export type ShelfLoadPhase = "checking" | "synchronizing" | "loading";

interface ShelfLoadOptions {
  fetchImplementation?: typeof fetch;
  onPhase?: (phase: ShelfLoadPhase) => void;
  signal?: AbortSignal;
}

interface ShelfRefreshOptions {
  fetchImplementation?: typeof fetch;
  signal?: AbortSignal;
}

interface ApiResult {
  response: Response;
  body: unknown;
}

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_USERNAME: "Enter a valid Hardcover username or profile URL.",
  PROFILE_NOT_FOUND: "No Hardcover profile was found for that username.",
  PROFILE_NOT_PUBLIC: "That Hardcover profile is not public.",
  HARDCOVER_UNAVAILABLE: "Hardcover could not complete this request.",
  HARDCOVER_TEMPORARILY_UNAVAILABLE:
    "Hardcover is temporarily unavailable. Try again shortly.",
  SERVER_CONFIGURATION_ERROR: "The profile service is not configured.",
  INTERNAL_SERVER_ERROR: "The shelf could not be loaded.",
};

export class ShelfLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShelfLoadError";
  }
}

export async function loadShelfSnapshot(
  input: string,
  options: ShelfLoadOptions = {},
): Promise<ShelfSnapshotDto> {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const profilePath = `/api/profiles/${encodeURIComponent(input)}`;

  options.onPhase?.("checking");
  let shelfResult = await requestJson(
    `${profilePath}/books`,
    {},
    fetchImplementation,
    options.signal,
  );

  if (isSnapshotNotFound(shelfResult)) {
    options.onPhase?.("synchronizing");
    const syncResult = await requestJson(
      `${profilePath}/sync`,
      { method: "POST" },
      fetchImplementation,
      options.signal,
    );

    if (!syncResult.response.ok) {
      throw new ShelfLoadError(errorMessage(syncResult.body));
    }

    options.onPhase?.("loading");
    shelfResult = await requestJson(
      `${profilePath}/books`,
      {},
      fetchImplementation,
      options.signal,
    );
  }

  if (!shelfResult.response.ok) {
    throw new ShelfLoadError(errorMessage(shelfResult.body));
  }

  if (!isShelfSnapshot(shelfResult.body)) {
    throw new ShelfLoadError("The server returned an unexpected response.");
  }

  return shelfResult.body;
}

export async function refreshShelfSnapshot(
  input: string,
  options: ShelfRefreshOptions = {},
): Promise<ShelfSnapshotDto> {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const profilePath = `/api/profiles/${encodeURIComponent(input)}`;
  const syncResult = await requestJson(
    `${profilePath}/sync`,
    { method: "POST" },
    fetchImplementation,
    options.signal,
  );

  if (!syncResult.response.ok) {
    throw new ShelfLoadError(errorMessage(syncResult.body));
  }

  const shelfResult = await requestJson(
    `${profilePath}/books`,
    {},
    fetchImplementation,
    options.signal,
  );

  if (!shelfResult.response.ok) {
    throw new ShelfLoadError(errorMessage(shelfResult.body));
  }

  if (!isShelfSnapshot(shelfResult.body)) {
    throw new ShelfLoadError("The server returned an unexpected response.");
  }

  return shelfResult.body;
}

async function requestJson(
  path: string,
  init: RequestInit,
  fetchImplementation: typeof fetch,
  signal?: AbortSignal,
): Promise<ApiResult> {
  const response = await fetchImplementation(path, {
    ...init,
    headers: { Accept: "application/json" },
    ...(signal ? { signal } : {}),
  });
  let body: unknown;

  try {
    body = await response.json();
  } catch {
    body = null;
  }

  return { response, body };
}

function isSnapshotNotFound(result: ApiResult): boolean {
  return (
    result.response.status === 404 &&
    errorCode(result.body) === "SNAPSHOT_NOT_FOUND"
  );
}

function errorMessage(body: unknown): string {
  const code = errorCode(body);
  return (code && ERROR_MESSAGES[code]) || "The shelf could not be loaded.";
}

function errorCode(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  const errorValue = (body as Record<string, unknown>).error;

  if (
    !errorValue ||
    typeof errorValue !== "object" ||
    Array.isArray(errorValue)
  ) {
    return null;
  }

  const code = (errorValue as Record<string, unknown>).code;
  return typeof code === "string" ? code : null;
}

function isShelfSnapshot(body: unknown): body is ShelfSnapshotDto {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return false;
  }

  const candidate = body as Partial<ShelfSnapshotDto>;
  return (
    isProfile(candidate.profile) &&
    isShelves(candidate.shelves) &&
    candidate.shelves.read.every(isShelfBook) &&
    candidate.shelves.wantToRead.every(isShelfBook)
  );
}

function isProfile(value: unknown): value is ShelfSnapshotDto["profile"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const profile = value as Record<string, unknown>;
  return (
    typeof profile.username === "string" &&
    (typeof profile.displayName === "string" || profile.displayName === null) &&
    typeof profile.lastSyncedAt === "string"
  );
}

function isShelves(value: unknown): value is ShelfSnapshotDto["shelves"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const shelves = value as Record<string, unknown>;
  return Array.isArray(shelves.read) && Array.isArray(shelves.wantToRead);
}

function isShelfBook(value: unknown): value is ShelfBookDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const book = value as Record<string, unknown>;
  return (
    isPositiveSafeInteger(book.id) &&
    typeof book.title === "string" &&
    Array.isArray(book.authors) &&
    book.authors.every((author) => typeof author === "string") &&
    (book.slug === null || isNonEmptyString(book.slug)) &&
    isCover(book.cover) &&
    (book.releaseYear === null || isSafeInteger(book.releaseYear)) &&
    (book.pages === null || isPositiveSafeInteger(book.pages)) &&
    (book.communityRating === null || isRating(book.communityRating)) &&
    isNonNegativeSafeInteger(book.ratingsCount) &&
    Array.isArray(book.series) &&
    book.series.every(isBookSeries) &&
    (book.userRating === null || isRating(book.userRating)) &&
    (book.firstReadDate === null || isIsoDate(book.firstReadDate)) &&
    (book.lastReadDate === null || isIsoDate(book.lastReadDate))
  );
}

function isCover(value: unknown): value is ShelfBookDto["cover"] {
  if (value === null) {
    return true;
  }

  if (!isRecord(value)) {
    return false;
  }

  return (
    isAllowedHardcoverCoverUrl(value.url) &&
    (value.width === null || isPositiveSafeInteger(value.width)) &&
    (value.height === null || isPositiveSafeInteger(value.height))
  );
}

function isBookSeries(
  value: unknown,
): value is ShelfBookDto["series"][number] {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isPositiveSafeInteger(value.id) &&
    isNonEmptyString(value.name) &&
    (value.position === null || isFiniteNumber(value.position)) &&
    typeof value.featured === "boolean"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return isSafeInteger(value) && value >= 0;
}

function isRating(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 5;
}
