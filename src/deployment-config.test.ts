import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";
import nextConfig from "../next.config";

const projectRoot = path.resolve(import.meta.dirname, "..");
const temporaryDirectories: string[] = [];

afterAll(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    if (directory.startsWith(path.join(tmpdir(), "hardcover-shelf-deploy-"))) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe("production deployment configuration", () => {
  it("builds Next.js with standalone output", () => {
    expect(nextConfig.output).toBe("standalone");
  });

  it("allows only HTTPS Hardcover assets without image redirects", () => {
    expect(nextConfig.images).toMatchObject({
      remotePatterns: [
        {
          protocol: "https",
          hostname: "assets.hardcover.app",
          port: "",
          pathname: "/**",
        },
      ],
      maximumRedirects: 0,
    });
    expect(nextConfig.images).not.toHaveProperty("domains");
    expect(nextConfig.images).not.toHaveProperty("dangerouslyAllowSVG", true);
    expect(nextConfig.images).not.toHaveProperty("dangerouslyAllowLocalIP", true);
  });

  it("packages the standalone server, static files, public files, and migrations", () => {
    const dockerfile = projectFile("Dockerfile");

    expect(dockerfile).toContain("/app/.next/standalone");
    expect(dockerfile).toContain("/app/.next/static");
    expect(dockerfile).toContain("/app/public");
    expect(dockerfile).toContain("/app/drizzle");
    expect(dockerfile).toContain("/app/node_modules/better-sqlite3");
    expect(dockerfile).toContain("/app/node_modules/drizzle-orm");
    expect(dockerfile).toContain("/app/docker-entrypoint.sh");
    expect(dockerfile).toContain("USER nextjs");
    expect(dockerfile).toContain("EXPOSE 8080");
  });

  it("excludes local credentials and SQLite data from the Docker context", () => {
    const dockerignore = projectFile(".dockerignore");

    expect(dockerignore).toMatch(/^\.env$/m);
    expect(dockerignore).toMatch(/^\.env\.\*$/m);
    expect(dockerignore).toMatch(/^data$/m);
    expect(dockerignore).toMatch(/^node_modules$/m);
  });

  it("configures one-region persistent SQLite and autostop/autostart", () => {
    const flyConfig = projectFile("fly.toml");

    expect(flyConfig).toContain('primary_region = "ewr"');
    expect(flyConfig).toContain('DATABASE_URL = "file:/data/hardcover-shelf.db"');
    expect(flyConfig).toContain('source = "hardcover_data"');
    expect(flyConfig).toContain('destination = "/data"');
    expect(flyConfig).toContain('initial_size = "1gb"');
    expect(flyConfig).toContain('auto_stop_machines = "stop"');
    expect(flyConfig).toContain("auto_start_machines = true");
    expect(flyConfig).toContain("min_machines_running = 0");
    expect(flyConfig).toContain('path = "/api/health"');
  });

  it("runs the versioned SQLite migration from the startup script", () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), "hardcover-shelf-deploy-"),
    );
    temporaryDirectories.push(directory);
    const filename = path.join(directory, "startup.db");

    execFileSync(process.execPath, ["scripts/migrate.mjs"], {
      cwd: projectRoot,
      env: {
        ...process.env,
        DATABASE_URL: `file:${filename}`,
      },
      stdio: "pipe",
    });

    const sqlite = new BetterSqlite3(filename, { readonly: true });

    try {
      const tables = sqlite
        .prepare(
          "select name from sqlite_master where type = 'table' and name in ('profiles', 'books', 'profile_books') order by name",
        )
        .all() as Array<{ name: string }>;
      expect(tables.map(({ name }) => name)).toEqual([
        "books",
        "profile_books",
        "profiles",
      ]);
    } finally {
      sqlite.close();
    }
  });
});

function projectFile(filename: string): string {
  return readFileSync(path.join(projectRoot, filename), "utf8");
}
