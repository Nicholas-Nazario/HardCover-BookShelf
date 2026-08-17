import "server-only";
import { normalizeHardcoverUsername } from "../../shared/usernames";
import { ProfileRepository, type ShelfSnapshotDto } from "./repository";

export function getCachedShelf(
  input: string,
  repository = new ProfileRepository(),
): ShelfSnapshotDto {
  return repository.getSnapshot(normalizeHardcoverUsername(input));
}
