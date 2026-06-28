import { describe, expect, it, vi } from "vitest";
import {
  convertWhisperResultToLyricsJson,
  transcribeLyricVideoAudio,
} from "./transcription-provider";

describe("transcription provider", () => {
  it("returns development stub transcription results", async () => {
    const result = await transcribeLyricVideoAudio({
      audioFileUrl: "/api/lyric-videos/video-1/audio",
      audioObjectKey: "lyric-videos/user-1/video-1/audio",
      env: createEnv(),
      lyricVideoId: "video-1",
      userId: "user-1",
    });

    expect(result).toEqual(
      expect.objectContaining({
        provider: "development-stub",
        lyricsJson: expect.objectContaining({
          lines: expect.arrayContaining([
            expect.objectContaining({ text: expect.any(String) }),
          ]),
        }),
      }),
    );
    expect(result.providerJobId).toBeUndefined();
  });

  it("calls Workers AI Whisper when configured", async () => {
    const audioBytes = new Uint8Array([1, 2, 3, 4]);
    const aiRun = vi.fn().mockResolvedValue({
      words: [
        { word: "Hello", start: 0, end: 0.4 },
        { word: "world", start: 0.4, end: 0.9 },
      ],
      text: "Hello world",
    });
    const bucketGet = vi.fn().mockResolvedValue({
      arrayBuffer: vi.fn().mockResolvedValue(audioBytes.buffer),
    });

    const result = await transcribeLyricVideoAudio({
      audioFileUrl: "/api/lyric-videos/video-1/audio",
      audioObjectKey: "lyric-videos/user-1/video-1/audio",
      env: createEnv({
        LYRIC_VIDEO_TRANSCRIPTION_PROVIDER: "workers-ai-whisper",
        LYRIC_VIDEO_BUCKET: { get: bucketGet },
        AI: { run: aiRun },
      }),
      lyricVideoId: "video-1",
      userId: "user-1",
    });

    expect(bucketGet).toHaveBeenCalledWith("lyric-videos/user-1/video-1/audio");
    expect(aiRun).toHaveBeenCalledWith("@cf/openai/whisper", {
      audio: [1, 2, 3, 4],
    });
    expect(result).toEqual(
      expect.objectContaining({
        provider: "workers-ai-whisper",
        durationSeconds: 1,
        lyricsJson: expect.objectContaining({
          lines: [
            expect.objectContaining({
              start: 0,
              end: 0.9,
              text: "Hello world",
            }),
          ],
        }),
      }),
    );
  });

  it("fails clearly when Workers AI audio is missing from R2", async () => {
    await expect(transcribeLyricVideoAudio({
      audioFileUrl: "/api/lyric-videos/video-1/audio",
      audioObjectKey: "lyric-videos/user-1/video-1/audio",
      env: createEnv({
        LYRIC_VIDEO_TRANSCRIPTION_PROVIDER: "workers-ai-whisper",
        LYRIC_VIDEO_BUCKET: { get: vi.fn().mockResolvedValue(null) },
        AI: { run: vi.fn() },
      }),
      lyricVideoId: "video-1",
      userId: "user-1",
    })).rejects.toThrow("Audio object was not found in R2");
  });

  it("infers duration from VTT when words are unavailable", async () => {
    const result = await transcribeLyricVideoAudio({
      audioFileUrl: "/api/lyric-videos/video-1/audio",
      audioObjectKey: "lyric-videos/user-1/video-1/audio",
      env: createEnv({
        LYRIC_VIDEO_TRANSCRIPTION_PROVIDER: "workers-ai-whisper",
        LYRIC_VIDEO_BUCKET: {
          get: vi.fn().mockResolvedValue({
            arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([1]).buffer),
          }),
        },
        AI: {
          run: vi.fn().mockResolvedValue({
            vtt: "WEBVTT\n\n00:00:00.000 --> 00:00:05.200\nHello",
            text: "Hello",
          }),
        },
      }),
      lyricVideoId: "video-1",
      userId: "user-1",
    });

    expect(result.durationSeconds).toBe(6);
  });

  it("converts Whisper words to LyricsJson", () => {
    const lyricsJson = convertWhisperResultToLyricsJson({
      words: [
        { word: "First", start: 0, end: 0.5 },
        { word: "line", start: 0.5, end: 1 },
        { word: "", start: 1, end: 1.2 },
        { word: "Second", start: 3, end: 3.4 },
        { word: "line", start: 3.4, end: 4 },
      ],
    });

    expect(lyricsJson.lines).toEqual([
      expect.objectContaining({ start: 0, end: 1, text: "First line" }),
      expect.objectContaining({ start: 3, end: 4, text: "Second line" }),
    ]);
  });

  it("converts Whisper vtt to LyricsJson", () => {
    const lyricsJson = convertWhisperResultToLyricsJson({
      vtt: [
        "WEBVTT",
        "",
        "00:00:00.000 --> 00:00:02.000",
        "First VTT line",
        "",
        "00:00:02.500 --> 00:00:05.000",
        "Second VTT line",
      ].join("\n"),
    });

    expect(lyricsJson.lines).toEqual([
      expect.objectContaining({ start: 0, end: 2, text: "First VTT line" }),
      expect.objectContaining({ start: 2.5, end: 5, text: "Second VTT line" }),
    ]);
  });

  it("falls back to estimated timings when Whisper only returns text", () => {
    const lyricsJson = convertWhisperResultToLyricsJson({
      text: "First fallback line. Second fallback line.",
    });

    expect(lyricsJson.lines).toEqual([
      expect.objectContaining({ start: 0, end: 3, text: "First fallback line." }),
      expect.objectContaining({ start: 3, end: 6, text: "Second fallback line." }),
    ]);
  });
});

function createEnv(overrides: Record<string, unknown> = {}) {
  return {
    LYRIC_VIDEO_BUCKET: {
      put: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
    },
    ...overrides,
  } as unknown as Env;
}
