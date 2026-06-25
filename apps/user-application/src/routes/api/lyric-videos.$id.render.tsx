import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import {
  errorResponse,
  jsonResponse,
  requireUserId,
} from "@/features/lyric-videos/api";
import { renderOwnedLyricVideo } from "@/features/lyric-videos/service";

export const Route = createFileRoute("/api/lyric-videos/$id/render")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const userId = await requireUserId(request);
          if (!userId) {
            return jsonResponse({ error: "Unauthorized" }, { status: 401 });
          }

          const result = await renderOwnedLyricVideo({
            userId,
            id: params.id,
            env,
          });
          if (!result) {
            return jsonResponse({ error: "Not found" }, { status: 404 });
          }
          return jsonResponse(result, { status: 202 });
        } catch (error) {
          return errorResponse(error);
        }
      },
    },
  },
});
