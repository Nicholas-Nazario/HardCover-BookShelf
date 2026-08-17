import "server-only";
import { mkdirSync } from "node:fs";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import {
  getDatabaseEnvironment,
  ServerConfigurationError,
} from "../server/env";
import * as schema from "./schema";

const DEFAULT_MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

export type AppDatabase = BetterSQLite3Database<typeof schema>;

export interface DatabaseHandle {
  db: AppDatabase;
  sqlite: BetterSqlite3.Database;
  filename: string;
  close(): void;
}

interface OpenDatabaseOptions {
  migrationsFolder?: string;
  migrateOnOpen?: boolean;
}

const processState = globalThis as typeof globalThis & {
  hardcoverShelfDatabase?: DatabaseHandle;
};

export function databaseFilenameFromUrl(
  databaseUrl = getDatabaseEnvironment().databaseUrl,
): string {
  if (!databaseUrl.startsWith("file:")) {
    throw new ServerConfigurationError(
      "DATABASE_URL must be a file: URL for SQLite.",
    );
  }

  const configuredFilename = databaseUrl.slice("file:".length);

  if (!configuredFilename) {
    throw new ServerConfigurationError(
      "DATABASE_URL must include a SQLite database filename.",
    );
  }

  if (configuredFilename === ":memory:") {
    return configuredFilename;
  }

  return path.resolve(configuredFilename);
}

export function openDatabase(
  filename: string,
  options: OpenDatabaseOptions = {},
): DatabaseHandle {
  const resolvedFilename =
    filename === ":memory:" ? filename : path.resolve(filename);

  if (resolvedFilename !== ":memory:") {
    mkdirSync(path.dirname(resolvedFilename), { recursive: true });
  }

  const sqlite = new BetterSqlite3(resolvedFilename);

  try {
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("busy_timeout = 5000");

    const db = drizzle(sqlite, { schema });

    if (options.migrateOnOpen !== false) {
      migrate(db, {
        migrationsFolder:
          options.migrationsFolder ?? DEFAULT_MIGRATIONS_FOLDER,
      });
    }

    return {
      db,
      sqlite,
      filename: resolvedFilename,
      close: () => sqlite.close(),
    };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

export function getDatabase(): DatabaseHandle {
  if (!processState.hardcoverShelfDatabase) {
    processState.hardcoverShelfDatabase = openDatabase(
      databaseFilenameFromUrl(),
    );
  }

  return processState.hardcoverShelfDatabase;
}
