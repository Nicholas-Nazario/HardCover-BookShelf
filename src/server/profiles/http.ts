import "server-only";
import { NextResponse } from "next/server";
import { ServerConfigurationError } from "../env";
import {
  HardcoverError,
  ProfileNotFoundError,
  ProfileNotPublicError,
} from "../hardcover/errors";
import { InvalidUsernameError } from "../../shared/usernames";
import { SnapshotNotFoundError } from "./repository";

export function profileErrorResponse(
  error: unknown,
  fallbackMessage: string,
): NextResponse {
  if (error instanceof InvalidUsernameError) {
    return errorResponse(error.code, error.message, 400);
  }

  if (error instanceof ProfileNotFoundError) {
    return errorResponse(error.code, error.message, 404);
  }

  if (error instanceof ProfileNotPublicError) {
    return errorResponse(error.code, error.message, 403);
  }

  if (error instanceof SnapshotNotFoundError) {
    return errorResponse(error.code, error.message, 404);
  }

  if (error instanceof ServerConfigurationError) {
    return errorResponse(
      error.code,
      "The profile service is not configured.",
      503,
    );
  }

  if (error instanceof HardcoverError) {
    return hardcoverErrorResponse(error);
  }

  return errorResponse("INTERNAL_SERVER_ERROR", fallbackMessage, 500);
}

export function jsonResponse(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function hardcoverErrorResponse(error: HardcoverError): NextResponse {
  switch (error.code) {
    case "HARDCOVER_AUTHENTICATION_FAILED":
      return errorResponse(
        "SERVER_CONFIGURATION_ERROR",
        "The profile service is not configured correctly.",
        503,
      );
    case "HARDCOVER_RATE_LIMITED":
    case "HARDCOVER_TIMEOUT":
      return errorResponse(
        "HARDCOVER_TEMPORARILY_UNAVAILABLE",
        "Hardcover is temporarily unavailable. Try again shortly.",
        503,
      );
    default:
      return errorResponse(
        "HARDCOVER_UNAVAILABLE",
        "The Hardcover API could not complete this request.",
        502,
      );
  }
}

function errorResponse(
  code: string,
  message: string,
  status: number,
): NextResponse {
  return jsonResponse({ error: { code, message } }, status);
}
