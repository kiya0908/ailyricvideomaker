// packages/data-ops/config/auth.ts
import { createBetterAuth } from "../src/auth/setup";
import Database from "better-sqlite3";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import path from "path";
import fs from "fs";

// Cloudflare D1 CLI configuration: use the local .wrangler D1 database
// This is ONLY for CLI schema generation and should not be used at runtime
function getD1DatabasePath(): string {
  const d1Dir = path.resolve(
    __dirname,
    "../../../apps/user-application/.wrangler/state/v3/d1/miniflare-D1DatabaseObject"
  );

  // Find the .sqlite file (ignoring .sqlite-shm and .sqlite-wal)
  if (fs.existsSync(d1Dir)) {
    const files = fs.readdirSync(d1Dir);
    const sqliteFile = files.find(
      (file) => file.endsWith(".sqlite") && !file.includes("-shm") && !file.includes("-wal")
    );
    if (sqliteFile) {
      return path.join(d1Dir, sqliteFile);
    }
  }

  // Fallback: create a temporary database if wrangler hasn't created one yet
  return path.resolve(__dirname, "test.sqlite");
}

export const auth = createBetterAuth({
  database: drizzleAdapter(new Database(getD1DatabasePath()), {
    provider: "sqlite",
  }),
});
