import { and, eq } from "drizzle-orm";
import { getDb } from "@repo/data-ops/database/setup";
import { lyricVideos } from "@repo/data-ops/drizzle/lyric-video-schema";
import {
  TranscriptionInfrastructureError,
  transcribeLyricVideoAudio,
} from "./transcription-provider";
import type { LyricsJson } from "./types";

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

const NOT_CONFIGURED_RENDER_PROVIDER = "not-configured";
const WORKERS_AI_WHISPER_PROVIDER = "workers-ai-whisper";

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
      await processRenderJob(job);
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

async function processRenderJob(job: RenderLyricVideoJob) {
  const existing = await findOwnedLyricVideo(job.userId, job.lyricVideoId);
  if (!existing) {
    console.warn("Lyric video render job target missing; acking stale job");
    return;
  }

  if (existing.renderJobId !== job.jobId || existing.status !== "rendering") {
    return;
  }

  await getDb()
    .update(lyricVideos)
    .set({
      status: "failed",
      errorMessage: "Render provider is not configured",
      failureStage: "render",
      renderProvider: NOT_CONFIGURED_RENDER_PROVIDER,
      outputObjectKey: null,
      updatedAt: new Date(),
    })
    .where(and(eq(lyricVideos.id, job.lyricVideoId), eq(lyricVideos.userId, job.userId)));
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
