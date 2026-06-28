import { describe, expect, it } from "vitest";
import {
  DEFAULT_DAILY_TRANSCRIPTION_LIMIT,
  DEFAULT_MAX_AUDIO_BYTES,
  DEFAULT_MAX_DURATION_SECONDS,
  getLyricVideoCostConfig,
} from "./config";

describe("getLyricVideoCostConfig", () => {
  it("uses conservative defaults when config is absent", () => {
    expect(getLyricVideoCostConfig({})).toEqual({
      maxAudioBytes: DEFAULT_MAX_AUDIO_BYTES,
      dailyTranscriptionLimit: DEFAULT_DAILY_TRANSCRIPTION_LIMIT,
      maxDurationSeconds: DEFAULT_MAX_DURATION_SECONDS,
    });
  });

  it("reads positive integer overrides", () => {
    expect(getLyricVideoCostConfig({
      LYRIC_VIDEO_MAX_AUDIO_BYTES: "1024",
      LYRIC_VIDEO_DAILY_TRANSCRIPTION_LIMIT: "3",
      LYRIC_VIDEO_MAX_DURATION_SECONDS: "120",
    })).toEqual({
      maxAudioBytes: 1024,
      dailyTranscriptionLimit: 3,
      maxDurationSeconds: 120,
    });
  });

  it.each(["", "0", "-1", "1.5", "not-a-number"])(
    "falls back when a numeric setting is invalid: %s",
    (invalidValue) => {
      const config = getLyricVideoCostConfig({
        LYRIC_VIDEO_MAX_AUDIO_BYTES: invalidValue,
        LYRIC_VIDEO_DAILY_TRANSCRIPTION_LIMIT: invalidValue,
        LYRIC_VIDEO_MAX_DURATION_SECONDS: invalidValue,
      });

      expect(config).toEqual({
        maxAudioBytes: DEFAULT_MAX_AUDIO_BYTES,
        dailyTranscriptionLimit: DEFAULT_DAILY_TRANSCRIPTION_LIMIT,
        maxDurationSeconds: DEFAULT_MAX_DURATION_SECONDS,
      });
    },
  );
});
