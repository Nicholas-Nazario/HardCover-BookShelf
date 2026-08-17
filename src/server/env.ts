import "server-only";

const DEFAULT_HARDCOVER_API_URL = "https://api.hardcover.app/v1/graphql";
const DEFAULT_DATABASE_URL = "file:./data/hardcover-shelf.db";

export interface ServerEnvironment {
  hardcoverApiToken: string;
  hardcoverApiUrl: string;
}

export interface DatabaseEnvironment {
  databaseUrl: string;
}

export class ServerConfigurationError extends Error {
  readonly code = "SERVER_CONFIGURATION_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "ServerConfigurationError";
  }
}

export function getServerEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): ServerEnvironment {
  const hardcoverApiToken = environment.HARDCOVER_API_TOKEN?.trim();

  if (!hardcoverApiToken) {
    throw new ServerConfigurationError(
      "HARDCOVER_API_TOKEN is not configured on the server.",
    );
  }

  const hardcoverApiUrl =
    environment.HARDCOVER_API_URL?.trim() || DEFAULT_HARDCOVER_API_URL;

  try {
    const url = new URL(hardcoverApiUrl);

    if (url.protocol !== "https:") {
      throw new Error("Hardcover API URL must use HTTPS.");
    }
  } catch {
    throw new ServerConfigurationError(
      "HARDCOVER_API_URL must be a valid HTTPS URL.",
    );
  }

  return { hardcoverApiToken, hardcoverApiUrl };
}

export function getDatabaseEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): DatabaseEnvironment {
  const databaseUrl = environment.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;

  if (!databaseUrl.startsWith("file:") || !databaseUrl.slice("file:".length)) {
    throw new ServerConfigurationError(
      "DATABASE_URL must be a file: URL with a SQLite database filename.",
    );
  }

  return { databaseUrl };
}
