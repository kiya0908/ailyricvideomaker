import { and, eq } from "drizzle-orm";
import { getDb } from "@repo/data-ops/database/setup";
import { lyricVideos } from "@repo/data-ops/drizzle/lyric-video-schema";
import { getLyricVideoCostConfig } from "./config";
import {
  DEVELOPMENT_STUB_RENDER_PROVIDER,
  getRenderLyricVideoProvider,
  NOT_CONFIGURED_RENDER_PROVIDER,
  RenderInfrastructureProviderError,
  RenderTerminalProviderError,
  type RenderLyricVideoProvider,
} from "./render-provider";
import {
  TranscriptionInfrastructureError,
  transcribeLyricVideoAudio,
} from "./transcription-provider";
import type { LyricsJson } from "./types";
import { LyricsJsonSchema, TemplateConfigSchema } from "./validation";

export type TranscribeLyricVideoJob = {
  type: "transcribe";
  jobId: string;
  lyricVideoId: string;
  userId: string;
  audioObjectKey?: string;
  createdAt: number;
};

export type RenderLyricVideoJob = {
  type: "render";
  jobId: string;
  lyricVideoId: string;
  userId: string;
  createdAt: number;
};

export type LyricVideoJob = TranscribeLyricVideoJob | RenderLyricVideoJob;

const WORKERS_AI_WHISPER_PROVIDER = "workers-ai-whisper";
const DEFAULT_MAX_LYRICS_LINES = 500;

type RenderJobEnv = Env & {
  LYRIC_VIDEO_BUCKET?: R2Bucket;
  LYRIC_VIDEO_RENDER_PROVIDER?: string;
  LYRIC_VIDEO_MAX_LYRICS_LINES?: string;
};

export async function processLyricVideoBatch(
  batch: MessageBatch<LyricVideoJob>,
  env: Env,
) {
  for (const message of batch.messages) {
    await processLyricVideoJob(message.body, env);
    message.ack();
  }
}

export async function processLyricVideoJob(job: LyricVideoJob, env: Env) {
  switch (job.type) {
    case "transcribe":
      await processTranscribeJob(job, env);
      return;
    case "render":
      await processRenderJob(job, env);
      return;
  }
}

async function processTranscribeJob(job: TranscribeLyricVideoJob, env: Env) {
  const existing = await findOwnedLyricVideo(job.userId, job.lyricVideoId);
  if (!existing) {
    console.warn("Lyric video transcribe job target missing; acking stale job");
    return;
  }

  if (existing.transcriptionJobId !== job.jobId || existing.status !== "transcribing") {
    return;
  }

  let transcription;
  try {
    transcription = await transcribeLyricVideoAudio({
      audioFileUrl: existing.audioFileUrl,
      audioObjectKey: job.audioObjectKey ?? existing.audioObjectKey,
      env,
      lyricVideoId: job.lyricVideoId,
      provider: existing.transcriptionProvider,
      userId: job.userId,
    });
  } catch (error) {
    if (error instanceof TranscriptionInfrastructureError) {
      throw error;
    }

    await recordTerminalTranscriptionFailure(job, error);
    return;
  }

  let current;
  try {
    current = await findOwnedLyricVideo(job.userId, job.lyricVideoId);
  } catch (error) {
    if (transcription.provider !== WORKERS_AI_WHISPER_PROVIDER) {
      throw error;
    }
    logPostProviderPersistenceFailure(job, "state-check");
    return;
  }

  if (
    !current ||
    current.transcriptionJobId !== job.jobId ||
    current.status !== "transcribing"
  ) {
    return;
  }

  const updateValues: {
    lyricsJson: LyricsJson;
    status: "ready-for-edit";
    transcriptionProvider: string;
    errorMessage: null;
    failureStage: null;
    durationSeconds?: number;
    updatedAt: Date;
  } = {
    lyricsJson: transcription.lyricsJson,
    status: "ready-for-edit",
    transcriptionProvider: transcription.provider,
    errorMessage: null,
    failureStage: null,
    updatedAt: new Date(),
  };

  if (transcription.durationSeconds !== undefined) {
    updateValues.durationSeconds = transcription.durationSeconds;
  }

  try {
    // transcriptionJobId is the internal Queue idempotency token. External
    // providerJobId needs a dedicated column before it can be persisted.
    await getDb()
      .update(lyricVideos)
      .set(updateValues)
      .where(and(
        eq(lyricVideos.id, job.lyricVideoId),
        eq(lyricVideos.userId, job.userId),
        eq(lyricVideos.transcriptionJobId, job.jobId),
        eq(lyricVideos.status, "transcribing"),
      ));
  } catch (error) {
    if (transcription.provider !== WORKERS_AI_WHISPER_PROVIDER) {
      throw error;
    }
    logPostProviderPersistenceFailure(job, "result-update");
  }
}

async function recordTerminalTranscriptionFailure(
  job: TranscribeLyricVideoJob,
  error: unknown,
) {
  let current;
  try {
    current = await findOwnedLyricVideo(job.userId, job.lyricVideoId);
  } catch {
    logPostProviderPersistenceFailure(job, "failure-state-check");
    return;
  }

  if (
    !current ||
    current.transcriptionJobId !== job.jobId ||
    current.status !== "transcribing"
  ) {
    return;
  }

  try {
    await getDb()
      .update(lyricVideos)
      .set({
        status: "failed",
        errorMessage: getErrorMessage(error),
        failureStage: "transcription",
        updatedAt: new Date(),
      })
      .where(and(
        eq(lyricVideos.id, job.lyricVideoId),
        eq(lyricVideos.userId, job.userId),
        eq(lyricVideos.transcriptionJobId, job.jobId),
        eq(lyricVideos.status, "transcribing"),
      ));
    console.warn("Lyric video transcription ended with a terminal provider failure", {
      jobId: job.jobId,
      lyricVideoId: job.lyricVideoId,
    });
  } catch {
    logPostProviderPersistenceFailure(job, "failure-update");
  }
}

function logPostProviderPersistenceFailure(
  job: TranscribeLyricVideoJob,
  operation: string,
) {
  console.error("Lyric video transcription persistence failed after provider boundary", {
    jobId: job.jobId,
    lyricVideoId: job.lyricVideoId,
    operation,
  });
}

export async function processRenderJob(
  job: RenderLyricVideoJob,
  env: RenderJobEnv,
  provider: RenderLyricVideoProvider = getRenderLyricVideoProvider(env),
) {
  const existing = await findOwnedLyricVideo(job.userId, job.lyricVideoId);
  if (!existing) {
    console.warn("Lyric video render job target missing; acking stale job");
    return;
  }

  if (existing.renderJobId !== job.jobId || existing.status !== "rendering") {
    return;
  }

  const bucket = getRenderBucket(env);
  const outputObjectKey = createRenderOutputKey(job);
  const existingOutput = await bucket.head(outputObjectKey);
  const existingOutputProvider = getReusableRenderOutputProvider(
    existingOutput,
    job.jobId,
  );
  if (existingOutputProvider) {
    await publishRenderReady(
      job,
      outputObjectKey,
      existingOutputProvider,
    );
    return;
  }

  if (!existing.audioObjectKey) {
    await recordTerminalRenderFailure(job, provider.name, "Audio object key is missing");
    return;
  }

  const lyricsResult = LyricsJsonSchema.safeParse(existing.lyricsJson);
  if (!lyricsResult.success || lyricsResult.data.lines.length === 0) {
    await recordTerminalRenderFailure(
      job,
      provider.name,
      "Lyrics are required before rendering",
    );
    return;
  }

  const maxLyricsLines = parsePositiveInteger(
    env.LYRIC_VIDEO_MAX_LYRICS_LINES,
    DEFAULT_MAX_LYRICS_LINES,
  );
  if (lyricsResult.data.lines.length > maxLyricsLines) {
    await recordTerminalRenderFailure(
      job,
      provider.name,
      `Lyrics exceed the ${maxLyricsLines}-line render limit`,
    );
    return;
  }

  const { maxDurationSeconds } = getLyricVideoCostConfig(env);
  if (
    existing.durationSeconds !== null &&
    existing.durationSeconds > maxDurationSeconds
  ) {
    await recordTerminalRenderFailure(
      job,
      provider.name,
      `Audio duration exceeds the ${maxDurationSeconds}-second render limit`,
    );
    return;
  }

  if (
    existing.durationSeconds === null &&
    provider.name !== NOT_CONFIGURED_RENDER_PROVIDER &&
    provider.name !== DEVELOPMENT_STUB_RENDER_PROVIDER
  ) {
    await recordTerminalRenderFailure(
      job,
      provider.name,
      "Audio duration is required before rendering",
    );
    return;
  }

  const audioObject = await bucket.get(existing.audioObjectKey);
  if (!audioObject) {
    await recordTerminalRenderFailure(
      job,
      provider.name,
      "Audio object is missing from R2",
      "storage",
    );
    return;
  }

  let result;
  try {
    result = await provider.render({
      lyricVideoId: job.lyricVideoId,
      userId: job.userId,
      idempotencyKey: job.jobId,
      audio: {
        objectKey: existing.audioObjectKey,
        body: audioObject.body,
        contentType: audioObject.httpMetadata?.contentType ?? "application/octet-stream",
      },
      lyricsJson: lyricsResult.data,
      templateConfig: TemplateConfigSchema.parse(existing.templateConfig),
      title: existing.title,
      durationSeconds: existing.durationSeconds,
    });
  } catch (error) {
    if (error instanceof RenderInfrastructureProviderError) {
      throw error;
    }

    const message = error instanceof RenderTerminalProviderError
      ? error.message
      : getErrorMessage(error);
    await recordTerminalRenderFailure(job, provider.name, message);
    return;
  }

  if (result.kind === "dry-run") {
    await recordTerminalRenderFailure(
      job,
      result.provider,
      "Development render stub does not produce a video artifact",
    );
    return;
  }

  if (isDryRunOnlyProvider(result.provider)) {
    await recordTerminalRenderFailure(
      job,
      result.provider,
      "Dry-run providers cannot return video artifacts",
    );
    return;
  }

  if (
    result.contentType !== "video/mp4" ||
    !result.body ||
    typeof result.body.getReader !== "function"
  ) {
    await recordTerminalRenderFailure(
      job,
      result.provider,
      "Render provider must return a video/mp4 stream",
    );
    return;
  }

  const current = await findOwnedLyricVideo(job.userId, job.lyricVideoId);
  if (
    !current ||
    current.renderJobId !== job.jobId ||
    current.status !== "rendering"
  ) {
    return;
  }

  await bucket.put(outputObjectKey, result.body, {
    httpMetadata: { contentType: "video/mp4" },
    customMetadata: {
      renderJobId: job.jobId,
      renderProvider: result.provider,
    },
  });

  const storedOutput = await bucket.head(outputObjectKey);
  if (!getReusableRenderOutputProvider(storedOutput, job.jobId)) {
    throw new RenderInfrastructureProviderError(
      "Rendered video could not be verified in R2",
    );
  }

  await publishRenderReady(job, outputObjectKey, result.provider);
}

function createRenderOutputKey(job: RenderLyricVideoJob) {
  return [
    "lyric-videos",
    encodeURIComponent(job.userId),
    encodeURIComponent(job.lyricVideoId),
    "renders",
    `${encodeURIComponent(job.jobId)}.mp4`,
  ].join("/");
}

function getReusableRenderOutputProvider(
  object: R2Object | null,
  renderJobId: string,
): string | null {
  if (
    !object ||
    object.size <= 0 ||
    object.httpMetadata?.contentType !== "video/mp4" ||
    object.customMetadata?.renderJobId !== renderJobId
  ) {
    return null;
  }

  const provider = object.customMetadata.renderProvider;
  return provider && !isDryRunOnlyProvider(provider) ? provider : null;
}

function isDryRunOnlyProvider(provider: string) {
  return provider === DEVELOPMENT_STUB_RENDER_PROVIDER ||
    provider === NOT_CONFIGURED_RENDER_PROVIDER;
}

async function publishRenderReady(
  job: RenderLyricVideoJob,
  outputObjectKey: string,
  provider: string,
) {
  await getDb()
    .update(lyricVideos)
    .set({
      status: "ready",
      outputObjectKey,
      outputVideoUrl: `/api/lyric-videos/${job.lyricVideoId}/output`,
      renderProvider: provider,
      errorMessage: null,
      failureStage: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(lyricVideos.id, job.lyricVideoId),
      eq(lyricVideos.userId, job.userId),
      eq(lyricVideos.renderJobId, job.jobId),
      eq(lyricVideos.status, "rendering"),
    ));
}

async function recordTerminalRenderFailure(
  job: RenderLyricVideoJob,
  provider: string,
  errorMessage: string,
  failureStage: "render" | "storage" = "render",
) {
  await getDb()
    .update(lyricVideos)
    .set({
      status: "failed",
      errorMessage,
      failureStage,
      renderProvider: provider,
      outputObjectKey: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(lyricVideos.id, job.lyricVideoId),
      eq(lyricVideos.userId, job.userId),
      eq(lyricVideos.renderJobId, job.jobId),
      eq(lyricVideos.status, "rendering"),
    ));
}

function getRenderBucket(env: RenderJobEnv) {
  if (!env.LYRIC_VIDEO_BUCKET) {
    throw new RenderInfrastructureProviderError(
      "LYRIC_VIDEO_BUCKET binding is not configured",
    );
  }
  return env.LYRIC_VIDEO_BUCKET;
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  if (!value?.trim()) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function findOwnedLyricVideo(userId: string, id: string) {
  const rows = await getDb()
    .select()
    .from(lyricVideos)
    .where(and(eq(lyricVideos.id, id), eq(lyricVideos.userId, userId)))
    .limit(1);

  return rows[0] ?? null;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown lyric video job error";
}
