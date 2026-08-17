import "server-only";
import {
  getServerEnvironment,
  type ServerEnvironment,
} from "../env";
import { HardcoverError } from "./errors";

const DEFAULT_TIMEOUT_MS = 25_000;

interface GraphQlError {
  message?: unknown;
}

interface GraphQlEnvelope {
  data?: unknown;
  errors?: GraphQlError[];
}

export interface HardcoverQuery {
  operationName: string;
  query: string;
  variables: Record<string, unknown>;
}

export interface HardcoverClientOptions {
  environment?: ServerEnvironment;
  fetchImplementation?: typeof fetch;
  timeoutMs?: number;
}

export type HardcoverQueryExecutor = (
  request: HardcoverQuery,
) => Promise<unknown>;

export async function executeHardcoverQuery(
  request: HardcoverQuery,
  options: HardcoverClientOptions = {},
): Promise<unknown> {
  const environment = options.environment ?? getServerEnvironment();
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImplementation(environment.hardcoverApiUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: toBearerToken(environment.hardcoverApiToken),
        "Content-Type": "application/json",
        "User-Agent": "Hardcover Shelf PoC",
      },
      body: JSON.stringify(request),
      cache: "no-store",
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      throw new HardcoverError(
        "HARDCOVER_AUTHENTICATION_FAILED",
        "Hardcover rejected the server credential.",
      );
    }

    if (response.status === 429) {
      throw new HardcoverError(
        "HARDCOVER_RATE_LIMITED",
        "Hardcover temporarily rate-limited the service.",
      );
    }

    if (!response.ok) {
      throw new HardcoverError(
        "HARDCOVER_UNAVAILABLE",
        `Hardcover returned HTTP ${response.status}.`,
      );
    }

    const envelope = await parseEnvelope(response);

    if (envelope.errors?.length) {
      throw new HardcoverError(
        "HARDCOVER_QUERY_FAILED",
        "Hardcover could not complete the profile query.",
      );
    }

    if (!("data" in envelope) || envelope.data == null) {
      throw new HardcoverError(
        "HARDCOVER_INVALID_RESPONSE",
        "Hardcover returned a response without data.",
      );
    }

    return envelope.data;
  } catch (error) {
    if (error instanceof HardcoverError) {
      throw error;
    }

    if (controller.signal.aborted) {
      throw new HardcoverError(
        "HARDCOVER_TIMEOUT",
        "The Hardcover request timed out.",
      );
    }

    throw new HardcoverError(
      "HARDCOVER_UNAVAILABLE",
      "The Hardcover API could not be reached.",
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function parseEnvelope(response: Response): Promise<GraphQlEnvelope> {
  try {
    const value: unknown = await response.json();

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Invalid GraphQL envelope.");
    }

    return value as GraphQlEnvelope;
  } catch {
    throw new HardcoverError(
      "HARDCOVER_INVALID_RESPONSE",
      "Hardcover returned an invalid JSON response.",
    );
  }
}

function toBearerToken(token: string): string {
  return /^Bearer\s/i.test(token) ? token : `Bearer ${token}`;
}
