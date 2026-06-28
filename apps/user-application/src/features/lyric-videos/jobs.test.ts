import { beforeEach, describe, expect, it, vi } from "vitest";
import { lyricVideos } from "@repo/data-ops/drizzle/lyric-video-schema";
import { processLyricVideoBatch, processLyricVideoJob } from "./jobs";

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
    mockGetDb.mockReturnValue(createDbForExistingVideo({
      ...baseRow,
      transcriptionProvider: "workers-ai-whisper",
    }, updates));

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
    }))).resolves.toBeUndefined();

    expect(updates).toContainEqual(
      expect.objectContaining({
        status: "failed",
        failureStage: "transcription",
        errorMessage: expect.stringContaining("Audio object was not found in R2"),
      }),
    );
  });

  it("acks provider failures and does not call Workers AI again on repeated delivery", async () => {
    const updates: unknown[] = [];
    const aiRun = vi.fn().mockRejectedValue(new Error("upstream request failed"));
    mockGetDb.mockReturnValue(createDbForExistingVideo({
      ...baseRow,
      transcriptionProvider: "workers-ai-whisper",
    }, updates));
    const job = {
      type: "transcribe" as const,
      jobId: "transcribe-job-1",
      lyricVideoId: "video-1",
      userId: "user-1",
      audioObjectKey: "lyric-videos/user-1/video-1/audio",
      createdAt: Date.now(),
    };
    const message = createQueueMessage(job);
    const env = createEnv({
      LYRIC_VIDEO_TRANSCRIPTION_PROVIDER: "workers-ai-whisper",
      LYRIC_VIDEO_BUCKET: {
        get: vi.fn().mockResolvedValue({
          arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([1, 2]).buffer),
        }),
      },
      AI: { run: aiRun },
    });

    await processLyricVideoBatch(createBatch(message), env);
    await processLyricVideoBatch(createBatch(message), env);

    expect(message.ack).toHaveBeenCalledTimes(2);
    expect(aiRun).toHaveBeenCalledOnce();
    expect(updates).toContainEqual(expect.objectContaining({
      status: "failed",
      failureStage: "transcription",
      errorMessage: "Workers AI transcription failed",
    }));
  });

  it("does not ack when D1 fails before the provider call", async () => {
    const message = createQueueMessage({
      type: "transcribe",
      jobId: "transcribe-job-1",
      lyricVideoId: "video-1",
      userId: "user-1",
      audioObjectKey: "lyric-videos/user-1/video-1/audio",
      createdAt: Date.now(),
    });
    mockGetDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: vi.fn().mockRejectedValue(new Error("D1 unavailable")),
          }),
        }),
      }),
    });

    await expect(
      processLyricVideoBatch(createBatch(message), createEnv()),
    ).rejects.toThrow("D1 unavailable");
    expect(message.ack).not.toHaveBeenCalled();
  });

  it("does not ack when R2 fails before the Workers AI call", async () => {
    const message = createQueueMessage({
      type: "transcribe",
      jobId: "transcribe-job-1",
      lyricVideoId: "video-1",
      userId: "user-1",
      audioObjectKey: "lyric-videos/user-1/video-1/audio",
      createdAt: Date.now(),
    });
    mockGetDb.mockReturnValue(createDbForExistingVideo({
      ...baseRow,
      transcriptionProvider: "workers-ai-whisper",
    }, []));
    const aiRun = vi.fn();

    await expect(processLyricVideoBatch(createBatch(message), createEnv({
      LYRIC_VIDEO_BUCKET: {
        get: vi.fn().mockRejectedValue(new Error("R2 unavailable")),
      },
      AI: { run: aiRun },
    }))).rejects.toThrow("R2 audio read failed before transcription");

    expect(message.ack).not.toHaveBeenCalled();
    expect(aiRun).not.toHaveBeenCalled();
  });

  it("acks instead of repeating a successful AI call when D1 fails afterward", async () => {
    const message = createQueueMessage({
      type: "transcribe",
      jobId: "transcribe-job-1",
      lyricVideoId: "video-1",
      userId: "user-1",
      audioObjectKey: "lyric-videos/user-1/video-1/audio",
      createdAt: Date.now(),
    });
    const selectLimit = vi.fn()
      .mockResolvedValueOnce([{
        ...baseRow,
        transcriptionProvider: "workers-ai-whisper",
      }])
      .mockRejectedValueOnce(new Error("D1 unavailable after AI"));
    mockGetDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({ limit: selectLimit }),
        }),
      }),
    });
    const aiRun = vi.fn().mockResolvedValue({
      words: [{ word: "Done", start: 0, end: 1 }],
      text: "Done",
    });

    await expect(processLyricVideoBatch(createBatch(message), createEnv({
      LYRIC_VIDEO_BUCKET: {
        get: vi.fn().mockResolvedValue({
          arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([1]).buffer),
        }),
      },
      AI: { run: aiRun },
    }))).resolves.toBeUndefined();

    expect(message.ack).toHaveBeenCalledOnce();
    expect(aiRun).toHaveBeenCalledOnce();
  });

  it("uses the provider persisted when the job was created", async () => {
    const updates: unknown[] = [];
    const aiRun = vi.fn();
    mockGetDb.mockReturnValue(createDbForExistingVideo({
      ...baseRow,
      transcriptionProvider: "development-stub",
    }, updates));

    await processLyricVideoJob({
      type: "transcribe",
      jobId: "transcribe-job-1",
      lyricVideoId: "video-1",
      userId: "user-1",
      audioObjectKey: "lyric-videos/user-1/video-1/audio",
      createdAt: Date.now(),
    }, createEnv({
      LYRIC_VIDEO_TRANSCRIPTION_PROVIDER: "workers-ai-whisper",
      AI: { run: aiRun },
    }));

    expect(aiRun).not.toHaveBeenCalled();
    expect(updates).toContainEqual(expect.objectContaining({
      status: "ready-for-edit",
      transcriptionProvider: "development-stub",
    }));
  });

  it("stores inferred duration and keeps long transcriptions ready for edit", async () => {
    const updates: unknown[] = [];
    mockGetDb.mockReturnValue(createDbForExistingVideo({
      ...baseRow,
      transcriptionProvider: "workers-ai-whisper",
    }, updates));

    await processLyricVideoJob({
      type: "transcribe",
      jobId: "transcribe-job-1",
      lyricVideoId: "video-1",
      userId: "user-1",
      audioObjectKey: "lyric-videos/user-1/video-1/audio",
      createdAt: Date.now(),
    }, createEnv({
      LYRIC_VIDEO_BUCKET: {
        get: vi.fn().mockResolvedValue({
          arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([1, 2]).buffer),
        }),
      },
      AI: {
        run: vi.fn().mockResolvedValue({
          words: [{ word: "Long", start: 0, end: 300.1 }],
          text: "Long",
        }),
      },
    }));

    expect(updates).toContainEqual(expect.objectContaining({
      status: "ready-for-edit",
      durationSeconds: 301,
      failureStage: null,
      errorMessage: null,
    }));
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
  let currentRow = rows[0];

  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: vi.fn().mockImplementation(async () => {
            if (rows.length === 0) {
              return [];
            }
            const row = rows.length === 1
              ? currentRow
              : rows[Math.min(selectCount, rows.length - 1)];
            selectCount += 1;
            return row ? [row] : [];
          }),
        }),
      }),
    }),
    update: () => ({
      set: (values: unknown) => {
        updates.push(values);
        if (currentRow) {
          currentRow = { ...currentRow, ...(values as Partial<typeof baseRow>) };
        }
        return {
          where: vi.fn().mockResolvedValue(undefined),
        };
      },
    }),
  };
}

function createQueueMessage(body: Parameters<typeof processLyricVideoJob>[0]) {
  return {
    body,
    ack: vi.fn(),
  };
}

function createBatch(message: ReturnType<typeof createQueueMessage>) {
  return {
    messages: [message],
  } as unknown as MessageBatch<Parameters<typeof processLyricVideoJob>[0]>;
}
