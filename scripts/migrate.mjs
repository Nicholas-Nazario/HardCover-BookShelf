import { mkdirSync } from "node:fs";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const DEFAULT_DATABASE_URL = "file:./data/hardcover-shelf.db";
const databaseUrl = process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;

if (!databaseUrl.startsWith("file:") || !databaseUrl.slice("file:".length)) {
  throw new Error(
    "DATABASE_URL must be a file: URL with a SQLite database filename.",
  );
}

const configuredFilename = databaseUrl.slice("file:".length);
const filename =
  configuredFilename === ":memory:"
    ? configuredFilename
    : path.resolve(configuredFilename);

if (filename !== ":memory:") {
  mkdirSync(path.dirname(filename), { recursive: true });
}

const sqlite = new BetterSqlite3(filename);

try {
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  migrate(drizzle(sqlite), {
    migrationsFolder: path.join(process.cwd(), "drizzle"),
  });
  console.log(JSON.stringify({ event: "database_migration_complete" }));
} finally {
  sqlite.close();
}
