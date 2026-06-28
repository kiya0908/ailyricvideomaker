import { and, count, desc, eq, gte } from "drizzle-orm";
import { getDb } from "@repo/data-ops/database/setup";
import { lyricVideos } from "@repo/data-ops/drizzle/lyric-video-schema";
import type { LyricVideoJob } from "./jobs";
import { getLyricVideoCostConfig } from "./config";
import {
  defaultTemplateConfig,
  emptyLyricsJson,
  normalizeLyricsJson,
} from "./lyrics";
import type {
  LyricVideo,
  LyricVideoFailureStage,
  LyricVideoStatus,
  LyricsJson,
  TemplateConfig,
} from "./types";
import { getConfiguredTranscriptionProviderName } from "./transcription-provider";
import { LyricsJsonSchema, TemplateConfigSchema } from "./validation";

type LyricVideoEnv = Env & {
  LYRIC_VIDEO_BUCKET?: R2Bucket;
  LYRIC_VIDEO_JOBS?: Queue<LyricVideoJob>;
};

type LyricVideoRow = typeof lyricVideos.$inferSelect;

type UpdateLyricVideoInput = {
  lyricsJson?: LyricsJson;
  templateConfig?: TemplateConfig;
};

const AUDIO_OBJECT_NAME = "audio";
const OUTPUT_OBJECT_NAME = "output.mp4";
const SUPPORTED_AUDIO_EXTENSIONS = new Set(["mp3", "wav", "m4a", "aac"]);
const NOT_CONFIGURED_RENDER_PROVIDER = "not-configured";
const WORKERS_AI_WHISPER_PROVIDER = "workers-ai-whisper";

export async function listLyricVideos(userId: string) {
  const rows = await getDb()
    .select()
    .from(lyricVideos)
    .where(eq(lyricVideos.userId, userId))
    .orderBy(desc(lyricVideos.createdAt));

  return rows.map(mapLyricVideoRow);
}

export async function getLyricVideo(userId: string, id: string) {
  const row = await findOwnedLyricVideo(userId, id);
  return row ? mapLyricVideoRow(row) : null;
}

export async function createLyricVideoFromUpload(input: {
  userId: string;
  title?: string;
  file: File;
  env: LyricVideoEnv;
}) {
  const costConfig = getLyricVideoCostConfig(input.env);
  validateAudioFile(input.file, costConfig.maxAudioBytes);
  const transcriptionProvider = getConfiguredTranscriptionProviderName(input.env);

  if (transcriptionProvider === WORKERS_AI_WHISPER_PROVIDER) {
    await assertDailyTranscriptionLimit(
      input.userId,
      costConfig.dailyTranscriptionLimit,
    );
  }

  const id = crypto.randomUUID();
  const now = new Date();
  const title = input.title?.trim() || stripExtension(input.file.name) || "Untitled lyric video";
  const audioKey = createObjectKey(input.userId, id, AUDIO_OBJECT_NAME);
  const audioFileUrl = createAssetUrl(id, "audio");
  const transcriptionJobId = crypto.randomUUID();
  const bucket = getBucket(input.env);

  await bucket.put(audioKey, input.file.stream(), {
    httpMetadata: {
      contentType: input.file.type || "application/octet-stream",
    },
  });

  let dbRecordCreated = false;

  try {
    await getDb().insert(lyricVideos).values({
      id,
      userId: input.userId,
      title,
      audioFileUrl,
      audioObjectKey: audioKey,
      lyricsJson: emptyLyricsJson,
      templateConfig: defaultTemplateConfig,
      status: "transcribing",
      outputVideoUrl: null,
      outputObjectKey: null,
      errorMessage: null,
      failureStage: null,
      transcriptionProvider,
      transcriptionJobId,
      renderProvider: null,
      renderJobId: null,
      fileSizeBytes: input.file.size,
      durationSeconds: null,
      createdAt: now,
      updatedAt: now,
    });
    dbRecordCreated = true;

    await enqueueLyricVideoJob(input.env, {
      type: "transcribe",
      jobId: transcriptionJobId,
      lyricVideoId: id,
      userId: input.userId,
      audioObjectKey: audioKey,
      createdAt: Date.now(),
    });
  } catch (error) {
    if (!dbRecordCreated) {
      await bucket.delete(audioKey);
    } else {
      await markLyricVideoFailed(input.userId, id, {
        errorMessage: getErrorMessage(error),
        failureStage: "transcription",
      });
    }
    throw error;
  }

  const created = await getLyricVideo(input.userId, id);
  if (!created) {
    throw new Error("Created lyric video could not be loaded");
  }
  return created;
}

export async function updateLyricVideo(
  userId: string,
  id: string,
  input: UpdateLyricVideoInput,
) {
  const existing = await findOwnedLyricVideo(userId, id);
  if (!existing) {
    return null;
  }

  const values: Partial<typeof lyricVideos.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (input.lyricsJson) {
    values.lyricsJson = normalizeLyricsJson(LyricsJsonSchema.parse(input.lyricsJson));
  }
  if (input.templateConfig) {
    values.templateConfig = TemplateConfigSchema.parse(input.templateConfig);
  }

  await getDb()
    .update(lyricVideos)
    .set(values)
    .where(and(eq(lyricVideos.id, id), eq(lyricVideos.userId, userId)));

  return getLyricVideo(userId, id);
}

export async function renderOwnedLyricVideo(input: {
  userId: string;
  id: string;
  env: LyricVideoEnv;
}) {
  const existing = await getLyricVideo(input.userId, input.id);
  if (!existing) {
    return null;
  }
  if (existing.status === "rendering") {
    return existing;
  }
  if (existing.status !== "ready-for-edit" && existing.status !== "ready") {
    throw new Error("Lyric video must be ready for edit before rendering");
  }

  const { maxDurationSeconds } = getLyricVideoCostConfig(input.env);
  if (
    existing.durationSeconds !== null &&
    existing.durationSeconds > maxDurationSeconds
  ) {
    throw new Error(
      `Audio duration exceeds the ${maxDurationSeconds}-second render limit`,
    );
  }

  const renderJobId = crypto.randomUUID();

  await getDb()
    .update(lyricVideos)
    .set({
      status: "rendering",
      errorMessage: null,
      failureStage: null,
      renderProvider: NOT_CONFIGURED_RENDER_PROVIDER,
      renderJobId,
      updatedAt: new Date(),
    })
    .where(and(eq(lyricVideos.id, input.id), eq(lyricVideos.userId, input.userId)));

  try {
    await enqueueLyricVideoJob(input.env, {
      type: "render",
      jobId: renderJobId,
      lyricVideoId: input.id,
      userId: input.userId,
      createdAt: Date.now(),
    });
  } catch (error) {
    await markLyricVideoFailed(input.userId, input.id, {
      errorMessage: getErrorMessage(error),
      failureStage: "render",
      outputObjectKey: null,
      renderProvider: NOT_CONFIGURED_RENDER_PROVIDER,
    });
    throw error;
  }

  return getLyricVideo(input.userId, input.id);
}

export async function getLyricVideoAsset(input: {
  userId: string;
  id: string;
  kind: "audio" | "output";
  env: LyricVideoEnv;
}) {
  const existing = await getLyricVideo(input.userId, input.id);
  if (!existing) {
    return null;
  }
  const objectKey =
    input.kind === "audio"
      ? existing.audioObjectKey ?? createObjectKey(input.userId, input.id, AUDIO_OBJECT_NAME)
      : existing.outputObjectKey ?? createObjectKey(input.userId, input.id, OUTPUT_OBJECT_NAME);
  const object = await getBucket(input.env).get(objectKey);
  return object;
}

function mapLyricVideoRow(row: LyricVideoRow): LyricVideo {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    audioFileUrl: row.audioFileUrl,
    audioObjectKey: row.audioObjectKey,
    lyricsJson: LyricsJsonSchema.parse(row.lyricsJson),
    templateConfig: TemplateConfigSchema.parse(row.templateConfig),
    status: row.status as LyricVideoStatus,
    outputVideoUrl: row.outputVideoUrl,
    outputObjectKey: row.outputObjectKey,
    errorMessage: row.errorMessage,
    failureStage: row.failureStage as LyricVideoFailureStage | null,
    transcriptionProvider: row.transcriptionProvider,
    transcriptionJobId: row.transcriptionJobId,
    renderProvider: row.renderProvider,
    renderJobId: row.renderJobId,
    fileSizeBytes: row.fileSizeBytes,
    durationSeconds: row.durationSeconds,
    createdAt: toMillis(row.createdAt),
    updatedAt: toMillis(row.updatedAt),
  };
}

async function findOwnedLyricVideo(userId: string, id: string) {
  const rows = await getDb()
    .select()
    .from(lyricVideos)
    .where(and(eq(lyricVideos.id, id), eq(lyricVideos.userId, userId)))
    .limit(1);

  return rows[0] ?? null;
}

async function markLyricVideoFailed(
  userId: string,
  id: string,
  input: {
    errorMessage: string;
    failureStage: LyricVideoFailureStage;
    outputObjectKey?: string | null;
    renderProvider?: string | null;
  },
) {
  const values: Partial<typeof lyricVideos.$inferInsert> = {
    status: "failed",
    errorMessage: input.errorMessage,
    failureStage: input.failureStage,
    updatedAt: new Date(),
  };

  if ("outputObjectKey" in input) {
    values.outputObjectKey = input.outputObjectKey;
  }
  if ("renderProvider" in input) {
    values.renderProvider = input.renderProvider;
  }

  await getDb()
    .update(lyricVideos)
    .set(values)
    .where(and(eq(lyricVideos.id, id), eq(lyricVideos.userId, userId)));
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown lyric video error";
}

async function assertDailyTranscriptionLimit(userId: string, limit: number) {
  const now = new Date();
  const utcDayStart = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  ));
  const rows = await getDb()
    .select({ total: count() })
    .from(lyricVideos)
    .where(and(
      eq(lyricVideos.userId, userId),
      eq(lyricVideos.transcriptionProvider, WORKERS_AI_WHISPER_PROVIDER),
      gte(lyricVideos.createdAt, utcDayStart),
    ));
  const total = Number(rows[0]?.total ?? 0);

  if (total >= limit) {
    throw new Error(`Daily transcription limit reached (${limit} per UTC day)`);
  }
}

function validateAudioFile(file: File, maxAudioBytes: number) {
  if (file.size === 0) {
    throw new Error("Audio file cannot be empty");
  }
  if (file.size > maxAudioBytes) {
    const limit = maxAudioBytes === 25 * 1024 * 1024
      ? "25MB"
      : `${maxAudioBytes} bytes`;
    throw new Error(`Audio file must be ${limit} or smaller`);
  }

  const name = file.name.toLowerCase();
  const extension = name.split(".").pop() ?? "";
  const hasSupportedExtension = SUPPORTED_AUDIO_EXTENSIONS.has(extension);
  const hasSupportedMimeType =
    file.type === "" ||
    file.type.startsWith("audio/") ||
    file.type === "application/octet-stream";

  if (!hasSupportedExtension || !hasSupportedMimeType) {
    throw new Error("Only mp3, wav, m4a, and aac audio files are supported");
  }
}

function getBucket(env: LyricVideoEnv) {
  if (!env.LYRIC_VIDEO_BUCKET) {
    throw new Error("LYRIC_VIDEO_BUCKET binding is not configured");
  }
  return env.LYRIC_VIDEO_BUCKET;
}

async function enqueueLyricVideoJob(env: LyricVideoEnv, job: LyricVideoJob) {
  if (!env.LYRIC_VIDEO_JOBS) {
    throw new Error("LYRIC_VIDEO_JOBS queue binding is not configured");
  }
  await env.LYRIC_VIDEO_JOBS.send(job);
}

function createObjectKey(userId: string, id: string, objectName: string) {
  return `lyric-videos/${encodeURIComponent(userId)}/${id}/${objectName}`;
}

function createAssetUrl(id: string, kind: "audio" | "output") {
  return `/api/lyric-videos/${id}/${kind}`;
}

function stripExtension(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "");
}

function toMillis(value: Date | number) {
  return value instanceof Date ? value.getTime() : value;
}
