import { validatePublicProfile } from "../../../../../server/hardcover/profile";
import {
  jsonResponse,
  profileErrorResponse,
} from "../../../../../server/profiles/http";

interface RouteContext {
  params: Promise<{ username: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { username } = await context.params;

  try {
    const profile = await validatePublicProfile(username);

    return jsonResponse(
      {
        status: "public",
        profile,
      },
    );
  } catch (error) {
    return profileErrorResponse(error, "The profile could not be validated.");
  }
}
