import { describe, expect, it } from "vitest";
import { canOpenLyricVideoOutput } from "./display";

describe("canOpenLyricVideoOutput", () => {
  it("only allows opening output when the video is ready", () => {
    expect(canOpenLyricVideoOutput({
      status: "ready",
      outputVideoUrl: "/api/lyric-videos/video-1/output",
    })).toBe(true);
    expect(canOpenLyricVideoOutput({
      status: "rendering",
      outputVideoUrl: "/api/lyric-videos/video-1/output",
    })).toBe(false);
    expect(canOpenLyricVideoOutput({
      status: "failed",
      outputVideoUrl: "/api/lyric-videos/video-1/output",
    })).toBe(false);
    expect(canOpenLyricVideoOutput({
      status: "ready",
      outputVideoUrl: null,
    })).toBe(false);
  });
});
