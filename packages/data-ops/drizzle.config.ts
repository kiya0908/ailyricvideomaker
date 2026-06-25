import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import type { Config } from "drizzle-kit";

function getLocalD1DB() {
  try {
    const basePath = path.resolve(__dirname, "../../apps/user-application/.wrangler/state/v3/d1/miniflare-D1DatabaseObject");
    const dbFile = fs
      .readdirSync(basePath, { encoding: "utf-8" })
      .find((f) => f.endsWith(".sqlite"));
    if (!dbFile) {
      throw new Error(`.sqlite file not found in ${basePath}`);
    }
    return path.resolve(basePath, dbFile);
  } catch (err) {
    console.log(`Error finding local D1 DB: ${err}`);
    return undefined;
  }
}

let config: Config;

if (process.env.NODE_ENV === "production") {
  config = {
    out: "./src/drizzle",
    schema: ["./src/drizzle/auth-schema.ts", "./src/drizzle/lyric-video-schema.ts"],
    dialect: "sqlite",
    tablesFilter: ["!_cf_KV", "!auth_*"],
    driver: "d1-http",
    dbCredentials: {
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.CLOUDFLARE_D1_ACCOUNT_ID ?? "",
      databaseId: process.env.CLOUDFLARE_DATABASE_ID ?? "",
      token: process.env.CLOUDFLARE_D1_TOKEN ?? process.env.CLOUDFLARE_D1_API_TOKEN ?? "",
    },
  };
} else {
  const localDb = getLocalD1DB();
  config = {
    out: "./src/drizzle",
    schema: ["./src/drizzle/auth-schema.ts", "./src/drizzle/lyric-video-schema.ts"],
    dialect: "sqlite",
    tablesFilter: ["!_cf_KV", "!auth_*"],
    ...(localDb ? { dbCredentials: { url: localDb } } : {}),
  };
  
  if (!localDb) {
    console.warn("Local D1 DB not found. Migrations will not run against local DB.");
  }
}

export default config satisfies Config;
