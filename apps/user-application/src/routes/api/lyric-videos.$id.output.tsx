import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { jsonResponse, requireUserId } from "@/features/lyric-videos/api";
import { getLyricVideoAsset } from "@/features/lyric-videos/service";

export const Route = createFileRoute("/api/lyric-videos/$id/output")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const userId = await requireUserId(request);
        if (!userId) {
          return jsonResponse({ error: "Unauthorized" }, { status: 401 });
        }

        const object = await getLyricVideoAsset({
          userId,
          id: params.id,
          kind: "output",
          env,
        });
        if (!object) {
          return jsonResponse({ error: "Not found" }, { status: 404 });
        }
        return new Response(object.body, {
          headers: {
            "content-type": object.httpMetadata?.contentType ?? "video/mp4",
          },
        });
      },
    },
  },
});
