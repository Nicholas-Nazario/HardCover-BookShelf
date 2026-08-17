export type HardcoverErrorCode =
  | "HARDCOVER_AUTHENTICATION_FAILED"
  | "HARDCOVER_INVALID_RESPONSE"
  | "HARDCOVER_QUERY_FAILED"
  | "HARDCOVER_RATE_LIMITED"
  | "HARDCOVER_TIMEOUT"
  | "HARDCOVER_UNAVAILABLE";

export class HardcoverError extends Error {
  constructor(
    readonly code: HardcoverErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "HardcoverError";
  }
}

export class ProfileNotFoundError extends Error {
  readonly code = "PROFILE_NOT_FOUND";

  constructor() {
    super("No Hardcover profile was found for that username.");
    this.name = "ProfileNotFoundError";
  }
}

export class ProfileNotPublicError extends Error {
  readonly code = "PROFILE_NOT_PUBLIC";

  constructor() {
    super("That Hardcover profile is not public.");
    this.name = "ProfileNotPublicError";
  }
}
