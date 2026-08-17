import "server-only";
import { normalizeHardcoverUsername } from "../../shared/usernames";
import {
  executeHardcoverQuery,
  type HardcoverQueryExecutor,
} from "../hardcover/client";
import {
  fetchPublicLibrary,
  READ_STATUS,
  WANT_TO_READ_STATUS,
} from "../hardcover/library";
import { validatePublicProfile } from "../hardcover/profile";
import { ProfileRepository, type ReplaceSnapshotInput } from "./repository";

export interface SyncResult {
  profile: {
    username: string;
    displayName: string | null;
  };
  counts: {
    read: number;
    wantToRead: number;
  };
  lastSyncedAt: string;
}

export interface SnapshotWriter {
  replaceSnapshot(input: ReplaceSnapshotInput): void;
}

interface ProfileSynchronizerDependencies {
  executeQuery?: HardcoverQueryExecutor;
  repository?: SnapshotWriter;
  now?: () => Date;
  pageSize?: number;
}

export type ProfileSynchronizer = (input: string) => Promise<SyncResult>;

export function createProfileSynchronizer(
  dependencies: ProfileSynchronizerDependencies = {},
): ProfileSynchronizer {
  const activeSynchronizations = new Map<string, Promise<SyncResult>>();
  const executeQuery = dependencies.executeQuery ?? executeHardcoverQuery;
  const now = dependencies.now ?? (() => new Date());

  return (input: string) => {
    const normalizedUsername = normalizeHardcoverUsername(input);
    const activeSynchronization = activeSynchronizations.get(normalizedUsername);

    if (activeSynchronization) {
      return activeSynchronization;
    }

    let pendingSynchronization: Promise<SyncResult>;
    pendingSynchronization = synchronizeProfileSnapshot(
      normalizedUsername,
      executeQuery,
      dependencies.repository,
      now,
      dependencies.pageSize,
    ).finally(() => {
      if (
        activeSynchronizations.get(normalizedUsername) ===
        pendingSynchronization
      ) {
        activeSynchronizations.delete(normalizedUsername);
      }
    });
    activeSynchronizations.set(normalizedUsername, pendingSynchronization);

    return pendingSynchronization;
  };
}

const synchronizeProfile = createProfileSynchronizer();

export { synchronizeProfile };

async function synchronizeProfileSnapshot(
  normalizedUsername: string,
  executeQuery: HardcoverQueryExecutor,
  repository: SnapshotWriter | undefined,
  now: () => Date,
  pageSize: number | undefined,
): Promise<SyncResult> {
  const profile = await validatePublicProfile(
    normalizedUsername,
    executeQuery,
  );
  const library = await fetchPublicLibrary(
    profile.id,
    executeQuery,
    pageSize,
  );
  const synchronizedAt = now().toISOString();

  (repository ?? new ProfileRepository()).replaceSnapshot({
    profile,
    library,
    synchronizedAt,
  });

  return {
    profile: {
      username: profile.username,
      displayName: profile.displayName,
    },
    counts: {
      read: library.filter((book) => book.statusId === READ_STATUS).length,
      wantToRead: library.filter(
        (book) => book.statusId === WANT_TO_READ_STATUS,
      ).length,
    },
    lastSyncedAt: synchronizedAt,
  };
}
