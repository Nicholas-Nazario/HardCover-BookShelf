const MAX_USERNAME_LENGTH = 64;
const USERNAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const HARDCOVER_HOSTS = new Set(["hardcover.app", "www.hardcover.app"]);

export class InvalidUsernameError extends Error {
  readonly code = "INVALID_USERNAME";

  constructor(message = "Enter a valid Hardcover username or profile URL.") {
    super(message);
    this.name = "InvalidUsernameError";
  }
}

export function normalizeHardcoverUsername(input: string): string {
  let candidate = input.trim();

  if (!candidate) {
    throw new InvalidUsernameError();
  }

  if (/^https?:\/\//i.test(candidate)) {
    candidate = usernameFromProfileUrl(candidate);
  }

  if (candidate.startsWith("@")) {
    candidate = candidate.slice(1);
  }

  candidate = candidate.trim();

  if (
    !candidate ||
    candidate.length > MAX_USERNAME_LENGTH ||
    !USERNAME_PATTERN.test(candidate)
  ) {
    throw new InvalidUsernameError();
  }

  return candidate.toLocaleLowerCase("en-US");
}

function usernameFromProfileUrl(input: string): string {
  let url: URL;

  try {
    url = new URL(input);
  } catch {
    throw new InvalidUsernameError();
  }

  if (!HARDCOVER_HOSTS.has(url.hostname.toLocaleLowerCase("en-US"))) {
    throw new InvalidUsernameError();
  }

  const pathSegments = url.pathname.split("/").filter(Boolean);

  if (pathSegments.length !== 1 || !pathSegments[0]?.startsWith("@")) {
    throw new InvalidUsernameError();
  }

  try {
    return decodeURIComponent(pathSegments[0]);
  } catch {
    throw new InvalidUsernameError();
  }
}
