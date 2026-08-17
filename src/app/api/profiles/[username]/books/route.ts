import {
  jsonResponse,
  profileErrorResponse,
} from "../../../../../server/profiles/http";
import { getCachedShelf } from "../../../../../server/profiles/read";

interface RouteContext {
  params: Promise<{ username: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { username } = await context.params;

  try {
    return jsonResponse(getCachedShelf(username));
  } catch (error) {
    return profileErrorResponse(error, "The cached shelf could not be loaded.");
  }
}
