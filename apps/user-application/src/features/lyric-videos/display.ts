import type { LyricVideo } from "./types";

export function canOpenLyricVideoOutput(
  video: Pick<LyricVideo, "status" | "outputVideoUrl">,
): video is Pick<LyricVideo, "status" | "outputVideoUrl"> & {
  status: "ready";
  outputVideoUrl: string;
} {
  return video.status === "ready" && Boolean(video.outputVideoUrl);
}
