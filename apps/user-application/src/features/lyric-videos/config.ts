export const DEFAULT_MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const DEFAULT_DAILY_TRANSCRIPTION_LIMIT = 5;
export const DEFAULT_MAX_DURATION_SECONDS = 300;

type LyricVideoCostConfigEnv = {
  LYRIC_VIDEO_MAX_AUDIO_BYTES?: string;
  LYRIC_VIDEO_DAILY_TRANSCRIPTION_LIMIT?: string;
  LYRIC_VIDEO_MAX_DURATION_SECONDS?: string;
};

export type LyricVideoCostConfig = {
  maxAudioBytes: number;
  dailyTranscriptionLimit: number;
  maxDurationSeconds: number;
};

export function getLyricVideoCostConfig(
  configEnv: LyricVideoCostConfigEnv,
): LyricVideoCostConfig {
  return {
    maxAudioBytes: parsePositiveInteger(
      configEnv.LYRIC_VIDEO_MAX_AUDIO_BYTES,
      DEFAULT_MAX_AUDIO_BYTES,
    ),
    dailyTranscriptionLimit: parsePositiveInteger(
      configEnv.LYRIC_VIDEO_DAILY_TRANSCRIPTION_LIMIT,
      DEFAULT_DAILY_TRANSCRIPTION_LIMIT,
    ),
    maxDurationSeconds: parsePositiveInteger(
      configEnv.LYRIC_VIDEO_MAX_DURATION_SECONDS,
      DEFAULT_MAX_DURATION_SECONDS,
    ),
  };
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  if (!value?.trim()) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
