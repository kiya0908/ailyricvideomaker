import { and, eq } from "drizzle-orm";
import { getDb } from "@repo/data-ops/database/setup";
import { lyricVideos } from "@repo/data-ops/drizzle/lyric-video-schema";
import { transcribeLyricVideoAudio } from "./transcription-provider";
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

  try {
    const transcription = await transcribeLyricVideoAudio({
      audioFileUrl: existing.audioFileUrl,
      audioObjectKey: job.audioObjectKey ?? existing.audioObjectKey,
      env,
      lyricVideoId: job.lyricVideoId,
      userId: job.userId,
    });
    const current = await findOwnedLyricVideo(job.userId, job.lyricVideoId);
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

    // transcriptionJobId is the internal Queue idempotency token. External
    // providerJobId needs a dedicated column before it can be persisted.
    await getDb()
      .update(lyricVideos)
      .set(updateValues)
      .where(and(eq(lyricVideos.id, job.lyricVideoId), eq(lyricVideos.userId, job.userId)));
  } catch (error) {
    const current = await findOwnedLyricVideo(job.userId, job.lyricVideoId);
    if (
      !current ||
      current.transcriptionJobId !== job.jobId ||
      current.status !== "transcribing"
    ) {
      return;
    }

    await getDb()
      .update(lyricVideos)
      .set({
        status: "failed",
        errorMessage: getErrorMessage(error),
        failureStage: "transcription",
        updatedAt: new Date(),
      })
      .where(and(eq(lyricVideos.id, job.lyricVideoId), eq(lyricVideos.userId, job.userId)));
    throw error;
  }
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
