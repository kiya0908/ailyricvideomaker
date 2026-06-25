import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import {
  errorResponse,
  jsonResponse,
  requireUserId,
} from "@/features/lyric-videos/api";
import {
  createLyricVideoFromUpload,
  listLyricVideos,
} from "@/features/lyric-videos/service";

export const Route = createFileRoute("/api/lyric-videos")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const userId = await requireUserId(request);
        if (!userId) {
          return jsonResponse({ error: "Unauthorized" }, { status: 401 });
        }

        const videos = await listLyricVideos(userId);
        return jsonResponse({ videos });
      },
      POST: async ({ request }) => {
        try {
          const userId = await requireUserId(request);
          if (!userId) {
            return jsonResponse({ error: "Unauthorized" }, { status: 401 });
          }

          const formData = await request.formData();
          const file = formData.get("file");
          const title = formData.get("title");
          if (!(file instanceof File)) {
            return jsonResponse({ error: "Audio file is required" }, { status: 400 });
          }

          const video = await createLyricVideoFromUpload({
            userId,
            file,
            title: typeof title === "string" ? title : undefined,
            env,
          });
          return jsonResponse({ video }, { status: 201 });
        } catch (error) {
          return errorResponse(error);
        }
      },
    },
  },
});
