import { createFileRoute } from "@tanstack/react-router";
import {
  errorResponse,
  jsonResponse,
  requireUserId,
} from "@/features/lyric-videos/api";
import {
  getLyricVideo,
  updateLyricVideo,
} from "@/features/lyric-videos/service";
import { UpdateLyricVideoSchema } from "@/features/lyric-videos/validation";

export const Route = createFileRoute("/api/lyric-videos/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const userId = await requireUserId(request);
        if (!userId) {
          return jsonResponse({ error: "Unauthorized" }, { status: 401 });
        }

        const video = await getLyricVideo(userId, params.id);
        if (!video) {
          return jsonResponse({ error: "Not found" }, { status: 404 });
        }
        return jsonResponse({ video });
      },
      PATCH: async ({ request, params }) => {
        try {
          const userId = await requireUserId(request);
          if (!userId) {
            return jsonResponse({ error: "Unauthorized" }, { status: 401 });
          }

          const body = UpdateLyricVideoSchema.parse(await request.json());
          const video = await updateLyricVideo(userId, params.id, body);
          if (!video) {
            return jsonResponse({ error: "Not found" }, { status: 404 });
          }
          return jsonResponse({ video });
        } catch (error) {
          return errorResponse(error);
        }
      },
    },
  },
});
