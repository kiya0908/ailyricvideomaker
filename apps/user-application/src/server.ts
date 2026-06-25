// DO NOT DELETE THIS FILE!!!
// This file is a good smoke test to make sure the custom server entry is working
import { setAuth } from "@repo/data-ops/auth/server";
import { initDatabase } from "@repo/data-ops/database/setup";
import handler from "@tanstack/react-start/server-entry";
import { env } from "cloudflare:workers";
import {
  processLyricVideoJob,
  type LyricVideoJob,
} from "@/features/lyric-videos/jobs";

console.log("[server-entry]: using custom server entry in 'src/server.ts'");

export default {
  fetch(request: Request) {
    const db = initDatabase(env.DB);

    setAuth({
      secret: env.BETTER_AUTH_SECRET,
      socialProviders: {
        google: {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
        },
      },
      adapter: {
        drizzleDb: db,
        provider: "sqlite",
      },
    });
    return handler.fetch(request, {
      context: {
        fromFetch: true,
      },
    });
  },
  async queue(batch: MessageBatch<LyricVideoJob>, workerEnv: Env) {
    initDatabase(workerEnv.DB);
    for (const message of batch.messages) {
      await processLyricVideoJob(message.body, workerEnv);
      message.ack();
    }
  },
};
