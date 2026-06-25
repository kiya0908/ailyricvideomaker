import { beforeEach, describe, expect, it, vi } from "vitest";
import { lyricVideos } from "@repo/data-ops/drizzle/lyric-video-schema";
import { processLyricVideoJob } from "./jobs";

const mockGetDb = vi.fn();

vi.mock("@repo/data-ops/database/setup", () => ({
  getDb: () => mockGetDb(),
}));

type LyricVideoRow = typeof lyricVideos.$inferSelect;

const baseRow: LyricVideoRow = {
  id: "video-1",
  userId: "user-1",
  title: "Test song",
  audioFileUrl: "/api/lyric-videos/video-1/audio",
  audioObjectKey: "lyric-videos/user-1/video-1/audio",
  lyricsJson: { lines: [] },
  templateConfig: {
    backgroundType: "color",
    backgroundValue: "#111827",
    fontFamily: "Geist",
    fontColor: "#f8fafc",
    fontSize: 56,
    animationStyle: "fade",
    aspectRatio: "16:9",
  },
  status: "transcribing",
  outputVideoUrl: null,
  outputObjectKey: null,
  errorMessage: null,
  failureStage: null,
  transcriptionProvider: "development-stub",
  transcriptionJobId: "transcribe-job-1",
  renderProvider: null,
  renderJobId: "render-job-1",
  fileSizeBytes: 5,
  durationSeconds: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

describe("processLyricVideoJob", () => {
  beforeEach(() => {
    mockGetDb.mockReset();
  });

  it("marks transcribe jobs ready for edit after development transcription", async () => {
    const updates: unknown[] = [];
    mockGetDb.mockReturnValue(createDbForExistingVideo(baseRow, updates));

    await processLyricVideoJob({
      type: "transcribe",
      jobId: "transcribe-job-1",
      lyricVideoId: "video-1",
      userId: "user-1",
      audioObjectKey: "lyric-videos/user-1/video-1/audio",
      createdAt: Date.now(),
    }, createEnv());

    expect(updates).toContainEqual(
      expect.objectContaining({
        status: "ready-for-edit",
        errorMessage: null,
        failureStage: null,
        transcriptionProvider: "development-stub",
        lyricsJson: expect.objectContaining({
          lines: expect.arrayContaining([
            expect.objectContaining({ text: expect.any(String) }),
          ]),
        }),
      }),
    );
    expect(updates).not.toContainEqual(
      expect.objectContaining({
        transcriptionJobId: expect.any(String),
      }),
    );
  });

  it("marks transcribe jobs failed when Workers AI audio is missing from R2", async () => {
    const updates: unknown[] = [];
    mockGetDb.mockReturnValue(createDbForExistingVideo(baseRow, updates));

    await expect(processLyricVideoJob({
      type: "transcribe",
      jobId: "transcribe-job-1",
      lyricVideoId: "video-1",
      userId: "user-1",
      audioObjectKey: "lyric-videos/user-1/video-1/audio",
      createdAt: Date.now(),
    }, createEnv({
      LYRIC_VIDEO_TRANSCRIPTION_PROVIDER: "workers-ai-whisper",
      LYRIC_VIDEO_BUCKET: {
        get: vi.fn().mockResolvedValue(null),
      },
      AI: {
        run: vi.fn(),
      },
    }))).rejects.toThrow("Audio object was not found in R2");

    expect(updates).toContainEqual(
      expect.objectContaining({
        status: "failed",
        failureStage: "transcription",
        errorMessage: expect.stringContaining("Audio object was not found in R2"),
      }),
    );
  });

  it("acks transcribe jobs when the target video no longer exists", async () => {
    const updates: unknown[] = [];
    mockGetDb.mockReturnValue(createDbForMissingVideo(updates));

    await expect(processLyricVideoJob({
      type: "transcribe",
      jobId: "transcribe-job-1",
      lyricVideoId: "missing-video",
      userId: "user-1",
      audioObjectKey: "lyric-videos/user-1/missing-video/audio",
      createdAt: Date.now(),
    }, createEnv())).resolves.toBeUndefined();

    expect(updates).toEqual([]);
  });

  it("skips transcribe jobs when the job id no longer matches", async () => {
    const updates: unknown[] = [];
    mockGetDb.mockReturnValue(createDbForExistingVideo({
      ...baseRow,
      transcriptionJobId: "newer-transcribe-job",
    }, updates));

    await processLyricVideoJob({
      type: "transcribe",
      jobId: "old-transcribe-job",
      lyricVideoId: "video-1",
      userId: "user-1",
      audioObjectKey: "lyric-videos/user-1/video-1/audio",
      createdAt: Date.now(),
    }, createEnv());

    expect(updates).toEqual([]);
  });

  it("skips repeated transcribe jobs after the video is ready for edit", async () => {
    const updates: unknown[] = [];
    mockGetDb.mockReturnValue(createDbForExistingVideo({
      ...baseRow,
      status: "ready-for-edit",
      transcriptionJobId: "transcribe-job-1",
      lyricsJson: {
        lines: [{ id: "edited-line", start: 0, end: 1, text: "User edited lyric" }],
      },
    }, updates));

    await processLyricVideoJob({
      type: "transcribe",
      jobId: "transcribe-job-1",
      lyricVideoId: "video-1",
      userId: "user-1",
      audioObjectKey: "lyric-videos/user-1/video-1/audio",
      createdAt: Date.now(),
    }, createEnv());

    expect(updates).toEqual([]);
  });

  it("does not mark failed transcribe jobs when status has already changed", async () => {
    const updates: unknown[] = [];
    const brokenRow = {
      ...baseRow,
      get audioFileUrl(): string {
        throw new Error("Provider failed");
      },
    };
    mockGetDb.mockReturnValue(createDbForVideoSequence([
      brokenRow,
      {
        ...baseRow,
        status: "ready-for-edit",
      },
    ], updates));

    await expect(processLyricVideoJob({
      type: "transcribe",
      jobId: "transcribe-job-1",
      lyricVideoId: "video-1",
      userId: "user-1",
      audioObjectKey: "lyric-videos/user-1/video-1/audio",
      createdAt: Date.now(),
    }, createEnv())).resolves.toBeUndefined();

    expect(updates).toEqual([]);
  });

  it("marks render jobs failed when no render provider is configured", async () => {
    const updates: unknown[] = [];
    mockGetDb.mockReturnValue(createDbForExistingVideo({
      ...baseRow,
      status: "rendering",
    }, updates));

    await processLyricVideoJob({
      type: "render",
      jobId: "render-job-1",
      lyricVideoId: "video-1",
      userId: "user-1",
      createdAt: Date.now(),
    }, createEnv());

    expect(updates).toContainEqual(
      expect.objectContaining({
        status: "failed",
        errorMessage: "Render provider is not configured",
        failureStage: "render",
        renderProvider: "not-configured",
        outputObjectKey: null,
      }),
    );
    expect(updates).not.toContainEqual(
      expect.objectContaining({
        status: "ready",
        outputObjectKey: expect.any(String),
      }),
    );
  });

  it("skips render jobs when the job id no longer matches", async () => {
    const updates: unknown[] = [];
    mockGetDb.mockReturnValue(createDbForExistingVideo({
      ...baseRow,
      status: "rendering",
      renderJobId: "newer-render-job",
    }, updates));

    await processLyricVideoJob({
      type: "render",
      jobId: "old-render-job",
      lyricVideoId: "video-1",
      userId: "user-1",
      createdAt: Date.now(),
    }, createEnv());

    expect(updates).toEqual([]);
  });

  it("skips render jobs when the video is no longer rendering", async () => {
    const updates: unknown[] = [];
    mockGetDb.mockReturnValue(createDbForExistingVideo({
      ...baseRow,
      status: "ready",
      renderJobId: "render-job-1",
      outputVideoUrl: "/api/lyric-videos/video-1/output",
    }, updates));

    await processLyricVideoJob({
      type: "render",
      jobId: "render-job-1",
      lyricVideoId: "video-1",
      userId: "user-1",
      createdAt: Date.now(),
    }, createEnv());

    expect(updates).toEqual([]);
  });

  it("acks render jobs when the target video no longer exists", async () => {
    const updates: unknown[] = [];
    mockGetDb.mockReturnValue(createDbForMissingVideo(updates));

    await expect(processLyricVideoJob({
      type: "render",
      jobId: "render-job-1",
      lyricVideoId: "missing-video",
      userId: "user-1",
      createdAt: Date.now(),
    }, createEnv())).resolves.toBeUndefined();

    expect(updates).toEqual([]);
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

function createDbForExistingVideo(row: typeof baseRow, updates: unknown[]) {
  return createDbForVideoSequence([row], updates);
}

function createDbForMissingVideo(updates: unknown[]) {
  return createDbForVideoSequence([], updates);
}

function createDbForVideoSequence(rows: Array<typeof baseRow>, updates: unknown[]) {
  let selectCount = 0;

  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: vi.fn().mockImplementation(async () => {
            if (rows.length === 0) {
              return [];
            }
            const row = rows[Math.min(selectCount, rows.length - 1)];
            selectCount += 1;
            return [row];
          }),
        }),
      }),
    }),
    update: () => ({
      set: (values: unknown) => {
        updates.push(values);
        return {
          where: vi.fn().mockResolvedValue(undefined),
        };
      },
    }),
  };
}
