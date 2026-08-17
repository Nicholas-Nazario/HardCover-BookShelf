import {
  jsonResponse,
  profileErrorResponse,
} from "../../../../../server/profiles/http";
import { synchronizeProfile } from "../../../../../server/profiles/sync";

interface RouteContext {
  params: Promise<{ username: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  const { username } = await context.params;

  try {
    return jsonResponse(await synchronizeProfile(username));
  } catch (error) {
    return profileErrorResponse(error, "The profile could not be synchronized.");
  }
}
