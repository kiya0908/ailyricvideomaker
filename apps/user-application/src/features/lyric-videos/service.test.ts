import { beforeEach, describe, expect, it, vi } from "vitest";
import { lyricVideos } from "@repo/data-ops/drizzle/lyric-video-schema";
import {
  createLyricVideoFromUpload,
  getLyricVideo,
  getLyricVideoAsset,
  renderOwnedLyricVideo,
} from "./service";

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
  lyricsJson: {
    lines: [{ id: "line-1", start: 0, end: 1, text: "Hello" }],
  },
  templateConfig: {
    backgroundType: "color",
    backgroundValue: "#111827",
    fontFamily: "Geist",
    fontColor: "#f8fafc",
    fontSize: 56,
    animationStyle: "fade",
    aspectRatio: "16:9",
  },
  status: "ready-for-edit",
  outputVideoUrl: null,
  outputObjectKey: null,
  errorMessage: null,
  failureStage: null,
  transcriptionProvider: null,
  transcriptionJobId: null,
  renderProvider: null,
  renderJobId: null,
  fileSizeBytes: 5,
  durationSeconds: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

describe("createLyricVideoFromUpload", () => {
  beforeEach(() => {
    mockGetDb.mockReset();
  });

  it("rejects non-audio files", async () => {
    const file = new File(["not audio"], "notes.txt", { type: "text/plain" });

    await expect(
      createLyricVideoFromUpload({
        userId: "user-1",
        file,
        env: createEnv(),
      }),
    ).rejects.toThrow("Only mp3, wav, m4a, and aac audio files are supported");
  });

  it("rejects files larger than 25MB", async () => {
    const file = new File(
      [new Uint8Array(25 * 1024 * 1024 + 1)],
      "song.mp3",
      { type: "audio/mpeg" },
    );

    await expect(
      createLyricVideoFromUpload({
        userId: "user-1",
        file,
        env: createEnv(),
      }),
    ).rejects.toThrow("Audio file must be 25MB or smaller");
  });

  it("rejects empty files", async () => {
    const file = new File([], "empty.mp3", { type: "audio/mpeg" });

    await expect(
      createLyricVideoFromUpload({
        userId: "user-1",
        file,
        env: createEnv(),
      }),
    ).rejects.toThrow("Audio file cannot be empty");
  });

  it("deletes the uploaded R2 object when DB creation fails", async () => {
    const bucket = createBucket();
    mockGetDb.mockReturnValue({
      insert: () => ({
        values: vi.fn().mockRejectedValue(new Error("DB insert failed")),
      }),
    });

    await expect(
      createLyricVideoFromUpload({
        userId: "user-1",
        file: new File(["audio"], "song.mp3", { type: "audio/mpeg" }),
        env: createEnv(bucket),
      }),
    ).rejects.toThrow("DB insert failed");

    expect(bucket.put).toHaveBeenCalledOnce();
    expect(bucket.delete).toHaveBeenCalledWith(
      expect.stringMatching(/^lyric-videos\/user-1\/[^/]+\/audio$/),
    );
  });

  it("stores the R2 audio object key and file size on creation", async () => {
    const insertedValues: unknown[] = [];
    const sentJobs: unknown[] = [];
    mockGetDb.mockReturnValue(createDbForCreatedVideo(insertedValues));

    await createLyricVideoFromUpload({
      userId: "user-1",
      file: new File(["audio"], "song.mp3", { type: "audio/mpeg" }),
      env: createEnv(createBucket(), createQueue(sentJobs)),
    });

    expect(insertedValues[0]).toEqual(
      expect.objectContaining({
        audioObjectKey: expect.stringMatching(/^lyric-videos\/user-1\/[^/]+\/audio$/),
        fileSizeBytes: 5,
        status: "transcribing",
        transcriptionProvider: "development-stub",
        transcriptionJobId: expect.any(String),
      }),
    );
    expect(sentJobs).toEqual([
      expect.objectContaining({
        type: "transcribe",
        jobId: (insertedValues[0] as typeof baseRow).transcriptionJobId,
        lyricVideoId: expect.any(String),
        userId: "user-1",
        audioObjectKey: expect.stringMatching(/^lyric-videos\/user-1\/[^/]+\/audio$/),
        createdAt: expect.any(Number),
      }),
    ]);
  });

  it("stores the configured transcription provider on creation", async () => {
    const insertedValues: unknown[] = [];
    const sentJobs: unknown[] = [];
    mockGetDb.mockReturnValue(createDbForCreatedVideo(insertedValues));

    await createLyricVideoFromUpload({
      userId: "user-1",
      file: new File(["audio"], "song.mp3", { type: "audio/mpeg" }),
      env: createEnv(createBucket(), createQueue(sentJobs), {
        LYRIC_VIDEO_TRANSCRIPTION_PROVIDER: "workers-ai-whisper",
      }),
    });

    expect(insertedValues[0]).toEqual(
      expect.objectContaining({
        transcriptionProvider: "workers-ai-whisper",
        transcriptionJobId: expect.any(String),
      }),
    );
    expect(sentJobs).toHaveLength(1);
  });


  it("marks the video failed when enqueueing transcription fails", async () => {
    const updates: unknown[] = [];
    mockGetDb.mockReturnValue(createDbForCreatedVideo([], updates));

    await expect(
      createLyricVideoFromUpload({
        userId: "user-1",
        file: new File(["audio"], "song.mp3", { type: "audio/mpeg" }),
        env: createEnv(createBucket(), createQueue([], new Error("Queue unavailable"))),
      }),
    ).rejects.toThrow("Queue unavailable");

    expect(updates).toContainEqual(
      expect.objectContaining({
        status: "failed",
        failureStage: "transcription",
        errorMessage: "Queue unavailable",
      }),
    );
  });
});

describe("renderOwnedLyricVideo", () => {
  beforeEach(() => {
    mockGetDb.mockReset();
  });

  it("does not create fake output when render provider is not configured", async () => {
    const bucket = createBucket();
    const updates: unknown[] = [];
    mockGetDb.mockReturnValue(createDbForExistingVideo(baseRow, updates));

    const result = await renderOwnedLyricVideo({
      userId: "user-1",
      id: "video-1",
      env: createEnv(bucket),
    });

    expect(bucket.put).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        status: "rendering",
      }),
    );
    expect(updates).not.toContainEqual(
      expect.objectContaining({
        status: "ready",
        outputVideoUrl: expect.any(String),
      }),
    );
    expect(updates).not.toContainEqual(
      expect.objectContaining({
        status: "failed",
        errorMessage: "Render provider is not configured",
        failureStage: "render",
        outputObjectKey: null,
        renderProvider: "not-configured",
      }),
    );
  });

  it("enqueues a render job without running the render provider synchronously", async () => {
    const sentJobs: unknown[] = [];
    mockGetDb.mockReturnValue(createDbForExistingVideo(baseRow, []));

    await renderOwnedLyricVideo({
      userId: "user-1",
      id: "video-1",
      env: createEnv(createBucket(), createQueue(sentJobs)),
    });

    expect(sentJobs).toEqual([
      expect.objectContaining({
        type: "render",
        jobId: expect.any(String),
        lyricVideoId: "video-1",
        userId: "user-1",
        createdAt: expect.any(Number),
      }),
    ]);
    expect(sentJobs[0]).toEqual(
      expect.objectContaining({
        jobId: expect.any(String),
      }),
    );
  });

  it("stores the render job id before enqueueing render jobs", async () => {
    const sentJobs: unknown[] = [];
    const updates: unknown[] = [];
    mockGetDb.mockReturnValue(createDbForExistingVideo(baseRow, updates));

    await renderOwnedLyricVideo({
      userId: "user-1",
      id: "video-1",
      env: createEnv(createBucket(), createQueue(sentJobs)),
    });

    const renderUpdate = updates.find(
      (update) => (update as typeof baseRow).status === "rendering",
    ) as typeof baseRow;
    expect(renderUpdate).toEqual(
      expect.objectContaining({
        renderJobId: expect.any(String),
      }),
    );
    expect(sentJobs[0]).toEqual(
      expect.objectContaining({
        jobId: renderUpdate.renderJobId,
      }),
    );
  });

  it("does not enqueue another render job while rendering", async () => {
    const sentJobs: unknown[] = [];
    const updates: unknown[] = [];
    mockGetDb.mockReturnValue(createDbForExistingVideo({
      ...baseRow,
      status: "rendering",
      renderJobId: "render-job-1",
    }, updates));

    const result = await renderOwnedLyricVideo({
      userId: "user-1",
      id: "video-1",
      env: createEnv(createBucket(), createQueue(sentJobs)),
    });

    expect(result).toEqual(expect.objectContaining({ status: "rendering" }));
    expect(sentJobs).toEqual([]);
    expect(updates).toEqual([]);
  });
});

describe("getLyricVideo", () => {
  beforeEach(() => {
    mockGetDb.mockReset();
  });

  it("returns failed videos with error message and failure stage", async () => {
    mockGetDb.mockReturnValue(createDbForExistingVideo({
      ...baseRow,
      status: "failed",
      errorMessage: "Render provider is not configured",
      failureStage: "render",
    }, []));

    const video = await getLyricVideo("user-1", "video-1");

    expect(video).toEqual(
      expect.objectContaining({
        status: "failed",
        errorMessage: "Render provider is not configured",
        failureStage: "render",
      }),
    );
  });
});

describe("getLyricVideoAsset", () => {
  beforeEach(() => {
    mockGetDb.mockReset();
  });

  it("uses the stored audio object key when loading audio", async () => {
    const bucket = createBucket();
    mockGetDb.mockReturnValue(createDbForExistingVideo({
      ...baseRow,
      audioObjectKey: "custom/audio/key",
    }, []));

    await getLyricVideoAsset({
      userId: "user-1",
      id: "video-1",
      kind: "audio",
      env: createEnv(bucket),
    });

    expect(bucket.get).toHaveBeenCalledWith("custom/audio/key");
  });
});

function createEnv(
  bucket = createBucket(),
  queue = createQueue(),
  overrides: Record<string, unknown> = {},
) {
  return {
    LYRIC_VIDEO_BUCKET: bucket,
    LYRIC_VIDEO_JOBS: queue,
    ...overrides,
  } as unknown as Env & { LYRIC_VIDEO_BUCKET: R2Bucket };
}

function createBucket() {
  return {
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

function createQueue(sentJobs: unknown[] = [], error?: Error) {
  return {
    send: vi.fn((message: unknown) => {
      if (error) {
        return Promise.reject(error);
      }
      sentJobs.push(message);
      return Promise.resolve();
    }),
  };
}

function createDbForCreatedVideo(insertedValues: unknown[], updates: unknown[] = []) {
  let row = { ...baseRow };
  return {
    insert: () => ({
      values: vi.fn((values: typeof baseRow) => {
        insertedValues.push(values);
        row = {
          ...row,
          ...values,
          lyricsJson: baseRow.lyricsJson,
          templateConfig: baseRow.templateConfig,
          status: "ready-for-edit",
        };
        return Promise.resolve();
      }),
    }),
    update: () => ({
      set: (values: Partial<typeof baseRow>) => {
        updates.push(values);
        row = { ...row, ...values };
        return {
          where: vi.fn().mockResolvedValue(undefined),
        };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: vi.fn().mockResolvedValue([row]),
        }),
      }),
    }),
  };
}

function createDbForExistingVideo(row: typeof baseRow, updates: unknown[]) {
  let currentRow = row;
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: vi.fn(() => Promise.resolve([currentRow])),
        }),
      }),
    }),
    update: () => ({
      set: (values: unknown) => {
        updates.push(values);
        currentRow = { ...currentRow, ...(values as Partial<typeof baseRow>) };
        return {
          where: vi.fn().mockResolvedValue(undefined),
        };
      },
    }),
  };
}
