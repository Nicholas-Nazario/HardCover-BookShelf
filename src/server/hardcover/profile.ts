import "server-only";
import { z } from "zod";
import { normalizeHardcoverUsername } from "../../shared/usernames";
import {
  executeHardcoverQuery,
  type HardcoverQueryExecutor,
} from "./client";
import {
  HardcoverError,
  ProfileNotFoundError,
  ProfileNotPublicError,
} from "./errors";

const PUBLIC_PROFILE_PRIVACY_SETTING = 1;

const profileDataSchema = z.object({
  users: z.array(
    z.object({
      id: z.number().int(),
      username: z.string().min(1),
      name: z.string().nullable(),
      books_count: z.number().int().nonnegative(),
      account_privacy_setting_id: z.number().int(),
    }),
  ),
});

const PUBLIC_PROFILE_QUERY = `
  query PublicProfile($username: citext!) {
    users(where: { username: { _eq: $username } }, limit: 1) {
      id
      username
      name
      books_count
      account_privacy_setting_id
    }
  }
`;

export interface PublicProfile {
  id: number;
  username: string;
  displayName: string | null;
  booksCount: number;
}

export async function validatePublicProfile(
  input: string,
  executeQuery: HardcoverQueryExecutor = executeHardcoverQuery,
): Promise<PublicProfile> {
  const username = normalizeHardcoverUsername(input);
  const rawData = await executeQuery({
    operationName: "PublicProfile",
    query: PUBLIC_PROFILE_QUERY,
    variables: { username },
  });
  const parsedData = profileDataSchema.safeParse(rawData);

  if (!parsedData.success) {
    throw new HardcoverError(
      "HARDCOVER_INVALID_RESPONSE",
      "Hardcover returned an unexpected profile response.",
    );
  }

  const profile = parsedData.data.users[0];

  if (!profile) {
    throw new ProfileNotFoundError();
  }

  if (profile.account_privacy_setting_id !== PUBLIC_PROFILE_PRIVACY_SETTING) {
    throw new ProfileNotPublicError();
  }

  return {
    id: profile.id,
    username: profile.username,
    displayName: profile.name,
    booksCount: profile.books_count,
  };
}
