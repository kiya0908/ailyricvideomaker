import { beforeEach, describe, expect, it, vi } from "vitest";
import { lyricVideos } from "@repo/data-ops/drizzle/lyric-video-schema";
import {
  processLyricVideoBatch,
  processLyricVideoJob,
  processRenderJob,
} from "./jobs";
import {
  RenderInfrastructureProviderError,
  RenderTerminalProviderError,
  type RenderLyricVideoProvider,
} from "./render-provider";

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
    mockGetDb.mockReturnValue(createDbForExistingVideo(createRenderingRow(), updates));
    const bucket = createRenderBucket();

    await processLyricVideoJob({
      type: "render",
      jobId: "render-job-1",
      lyricVideoId: "video-1",
      userId: "user-1",
      createdAt: Date.now(),
    }, createEnv({ LYRIC_VIDEO_BUCKET: bucket }));

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
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("passes env selection through to the development render stub", async () => {
    const updates: unknown[] = [];
    mockGetDb.mockReturnValue(createDbForExistingVideo(createRenderingRow({
      durationSeconds: null,
    }), updates));
    const bucket = createRenderBucket();

    await processLyricVideoJob(createRenderJob(), createEnv({
      LYRIC_VIDEO_BUCKET: bucket,
      LYRIC_VIDEO_RENDER_PROVIDER: "development-stub-render",
    }));

    expect(updates).toContainEqual(expect.objectContaining({
      status: "failed",
      errorMessage: "Development render stub does not produce a video artifact",
      failureStage: "render",
      renderProvider: "development-stub-render",
    }));
    expect(bucket.put).not.toHaveBeenCalled();
    expect(updates).not.toContainEqual(expect.objectContaining({ status: "ready" }));
  });

  it("fails before provider invocation when audioObjectKey is missing", async () => {
    const updates: unknown[] = [];
    const provider = createFakeProvider();
    mockGetDb.mockReturnValue(createDbForExistingVideo(createRenderingRow({
      audioObjectKey: null,
    }), updates));
    const bucket = createRenderBucket();

    await processRenderJob(createRenderJob(), createEnv({
      LYRIC_VIDEO_BUCKET: bucket,
    }), provider);

    expect(provider.render).not.toHaveBeenCalled();
    expect(bucket.get).not.toHaveBeenCalled();
    expect(updates).toContainEqual(expect.objectContaining({
      status: "failed",
      errorMessage: "Audio object key is missing",
      failureStage: "render",
    }));
  });

  it("records a storage failure before provider invocation when audio is missing", async () => {
    const updates: unknown[] = [];
    const provider = createFakeProvider();
    mockGetDb.mockReturnValue(createDbForExistingVideo(createRenderingRow(), updates));
    const bucket = createRenderBucket({ audioObject: null });

    await processRenderJob(createRenderJob(), createEnv({
      LYRIC_VIDEO_BUCKET: bucket,
    }), provider);

    expect(provider.render).not.toHaveBeenCalled();
    expect(updates).toContainEqual(expect.objectContaining({
      status: "failed",
      errorMessage: "Audio object is missing from R2",
      failureStage: "storage",
    }));
  });

  it("fails before provider invocation when lyrics are empty", async () => {
    const updates: unknown[] = [];
    const provider = createFakeProvider();
    mockGetDb.mockReturnValue(createDbForExistingVideo(createRenderingRow({
      lyricsJson: { lines: [] },
    }), updates));
    const bucket = createRenderBucket();

    await processRenderJob(createRenderJob(), createEnv({
      LYRIC_VIDEO_BUCKET: bucket,
    }), provider);

    expect(provider.render).not.toHaveBeenCalled();
    expect(bucket.get).not.toHaveBeenCalled();
    expect(updates).toContainEqual(expect.objectContaining({
      status: "failed",
      errorMessage: "Lyrics are required before rendering",
      failureStage: "render",
    }));
  });

  it("rejects unknown duration for a real provider before invocation", async () => {
    const updates: unknown[] = [];
    const provider = createFakeProvider({ name: "real-render-provider" });
    mockGetDb.mockReturnValue(createDbForExistingVideo(createRenderingRow({
      durationSeconds: null,
    }), updates));

    await processRenderJob(createRenderJob(), createEnv({
      LYRIC_VIDEO_BUCKET: createRenderBucket(),
    }), provider);

    expect(provider.render).not.toHaveBeenCalled();
    expect(updates).toContainEqual(expect.objectContaining({
      status: "failed",
      errorMessage: "Audio duration is required before rendering",
      failureStage: "render",
    }));
  });

  it("rejects duration and lyric limits before provider invocation", async () => {
    const durationUpdates: unknown[] = [];
    const durationProvider = createFakeProvider();
    mockGetDb.mockReturnValue(createDbForExistingVideo(createRenderingRow({
      durationSeconds: 301,
    }), durationUpdates));

    await processRenderJob(createRenderJob(), createEnv({
      LYRIC_VIDEO_BUCKET: createRenderBucket(),
      LYRIC_VIDEO_MAX_DURATION_SECONDS: "300",
    }), durationProvider);

    expect(durationProvider.render).not.toHaveBeenCalled();
    expect(durationUpdates).toContainEqual(expect.objectContaining({
      errorMessage: "Audio duration exceeds the 300-second render limit",
    }));

    const lyricsUpdates: unknown[] = [];
    const lyricsProvider = createFakeProvider();
    mockGetDb.mockReturnValue(createDbForExistingVideo(createRenderingRow({
      lyricsJson: {
        lines: [
          { id: "line-1", start: 0, end: 1, text: "One" },
          { id: "line-2", start: 1, end: 2, text: "Two" },
        ],
      },
    }), lyricsUpdates));

    await processRenderJob(createRenderJob(), createEnv({
      LYRIC_VIDEO_BUCKET: createRenderBucket(),
      LYRIC_VIDEO_MAX_LYRICS_LINES: "1",
    }), lyricsProvider);

    expect(lyricsProvider.render).not.toHaveBeenCalled();
    expect(lyricsUpdates).toContainEqual(expect.objectContaining({
      errorMessage: "Lyrics exceed the 1-line render limit",
    }));
  });

  it("records terminal provider failures with the selected provider", async () => {
    const updates: unknown[] = [];
    const provider = createFakeProvider({
      error: new RenderTerminalProviderError("Template is not supported"),
    });
    mockGetDb.mockReturnValue(createDbForExistingVideo(createRenderingRow(), updates));

    await processRenderJob(createRenderJob(), createEnv({
      LYRIC_VIDEO_BUCKET: createRenderBucket(),
    }), provider);

    expect(updates).toContainEqual(expect.objectContaining({
      status: "failed",
      errorMessage: "Template is not supported",
      failureStage: "render",
      renderProvider: "fake-render-provider",
    }));
  });

  it("throws infrastructure provider failures for Queue retry", async () => {
    const updates: unknown[] = [];
    const provider = createFakeProvider({
      error: new RenderInfrastructureProviderError("Provider unavailable"),
    });
    mockGetDb.mockReturnValue(createDbForExistingVideo(createRenderingRow(), updates));

    await expect(processRenderJob(createRenderJob(), createEnv({
      LYRIC_VIDEO_BUCKET: createRenderBucket(),
    }), provider)).rejects.toThrow("Provider unavailable");

    expect(updates).toEqual([]);
  });

  it("streams a video result to a job-scoped key before publishing ready", async () => {
    const updates: unknown[] = [];
    const videoBody = new ReadableStream<Uint8Array>();
    const provider = createVideoProvider(videoBody);
    mockGetDb.mockReturnValue(createDbForExistingVideo(createRenderingRow(), updates));
    const outputObject = createOutputObject();
    const bucket = createRenderBucket({
      outputHeads: [null, outputObject],
    });

    await processRenderJob(createRenderJob(), createEnv({
      LYRIC_VIDEO_BUCKET: bucket,
    }), provider);

    const outputKey = "lyric-videos/user-1/video-1/renders/render-job-1.mp4";
    expect(bucket.put).toHaveBeenCalledWith(
      outputKey,
      videoBody,
      expect.objectContaining({
        httpMetadata: { contentType: "video/mp4" },
        customMetadata: expect.objectContaining({
          renderJobId: "render-job-1",
          renderProvider: "fake-video-provider",
        }),
      }),
    );
    expect(updates).toContainEqual(expect.objectContaining({
      status: "ready",
      outputObjectKey: outputKey,
      outputVideoUrl: "/api/lyric-videos/video-1/output",
      renderProvider: "fake-video-provider",
      errorMessage: null,
      failureStage: null,
    }));
  });

  it("reuses a verified job-scoped output without invoking the provider again", async () => {
    const updates: unknown[] = [];
    const provider = createVideoProvider();
    mockGetDb.mockReturnValue(createDbForExistingVideo(createRenderingRow(), updates));
    const bucket = createRenderBucket({
      outputHeads: [createOutputObject()],
    });

    await processRenderJob(createRenderJob(), createEnv({
      LYRIC_VIDEO_BUCKET: bucket,
    }), provider);

    expect(provider.render).not.toHaveBeenCalled();
    expect(bucket.get).not.toHaveBeenCalled();
    expect(bucket.put).not.toHaveBeenCalled();
    expect(updates).toContainEqual(expect.objectContaining({
      status: "ready",
      outputObjectKey: "lyric-videos/user-1/video-1/renders/render-job-1.mp4",
    }));
  });

  it("does not attribute an existing output without provider metadata to the stub", async () => {
    const updates: unknown[] = [];
    mockGetDb.mockReturnValue(createDbForExistingVideo(createRenderingRow(), updates));
    const output = createOutputObject({ renderJobId: "render-job-1" });
    const bucket = createRenderBucket({ outputHeads: [output] });

    await processRenderJob(createRenderJob(), createEnv({
      LYRIC_VIDEO_BUCKET: bucket,
      LYRIC_VIDEO_RENDER_PROVIDER: "development-stub-render",
    }));

    expect(updates).toContainEqual(expect.objectContaining({
      status: "failed",
      renderProvider: "development-stub-render",
    }));
    expect(updates).not.toContainEqual(expect.objectContaining({ status: "ready" }));
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("does not persist provider output after the render job becomes stale", async () => {
    const updates: unknown[] = [];
    const provider = createVideoProvider();
    mockGetDb.mockReturnValue(createDbForVideoSequence([
      createRenderingRow(),
      createRenderingRow({ renderJobId: "newer-render-job" }),
    ], updates));
    const bucket = createRenderBucket({ outputHeads: [null] });

    await processRenderJob(createRenderJob(), createEnv({
      LYRIC_VIDEO_BUCKET: bucket,
    }), provider);

    expect(provider.render).toHaveBeenCalledOnce();
    expect(bucket.put).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it("throws when R2 output persistence fails and does not publish ready", async () => {
    const updates: unknown[] = [];
    const provider = createVideoProvider();
    mockGetDb.mockReturnValue(createDbForExistingVideo(createRenderingRow(), updates));
    const bucket = createRenderBucket({
      outputHeads: [null],
      putError: new Error("R2 unavailable"),
    });

    await expect(processRenderJob(createRenderJob(), createEnv({
      LYRIC_VIDEO_BUCKET: bucket,
    }), provider)).rejects.toThrow("R2 unavailable");

    expect(updates).toEqual([]);
  });

  it("keeps the R2 output reusable when the ready update fails", async () => {
    const provider = createVideoProvider();
    mockGetDb.mockReturnValue(createDbWithUpdateFailure(
      createRenderingRow(),
      new Error("D1 unavailable"),
    ));
    const bucket = createRenderBucket({
      outputHeads: [null, createOutputObject()],
    });

    await expect(processRenderJob(createRenderJob(), createEnv({
      LYRIC_VIDEO_BUCKET: bucket,
    }), provider)).rejects.toThrow("D1 unavailable");

    expect(bucket.put).toHaveBeenCalledOnce();
  });

  it("rejects a non-MP4 provider result without writing output", async () => {
    const updates: unknown[] = [];
    const provider = {
      name: "invalid-video-provider",
      render: vi.fn().mockResolvedValue({
        kind: "video",
        provider: "invalid-video-provider",
        body: new ReadableStream<Uint8Array>(),
        contentType: "text/plain",
      }),
    } as unknown as RenderLyricVideoProvider;
    mockGetDb.mockReturnValue(createDbForExistingVideo(createRenderingRow(), updates));
    const bucket = createRenderBucket({ outputHeads: [null] });

    await processRenderJob(createRenderJob(), createEnv({
      LYRIC_VIDEO_BUCKET: bucket,
    }), provider);

    expect(bucket.put).not.toHaveBeenCalled();
    expect(updates).toContainEqual(expect.objectContaining({
      status: "failed",
      errorMessage: "Render provider must return a video/mp4 stream",
      failureStage: "render",
    }));
  });

  it("rejects a video result that claims to come from the development stub", async () => {
    const updates: unknown[] = [];
    const provider = {
      name: "development-stub-render",
      render: vi.fn().mockResolvedValue({
        kind: "video",
        provider: "development-stub-render",
        body: new ReadableStream<Uint8Array>(),
        contentType: "video/mp4",
      }),
    } as unknown as RenderLyricVideoProvider;
    mockGetDb.mockReturnValue(createDbForExistingVideo(createRenderingRow(), updates));
    const bucket = createRenderBucket({ outputHeads: [null] });

    await processRenderJob(createRenderJob(), createEnv({
      LYRIC_VIDEO_BUCKET: bucket,
    }), provider);

    expect(bucket.put).not.toHaveBeenCalled();
    expect(updates).toContainEqual(expect.objectContaining({
      status: "failed",
      renderProvider: "development-stub-render",
    }));
    expect(updates).not.toContainEqual(expect.objectContaining({ status: "ready" }));
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

function createRenderJob() {
  return {
    type: "render" as const,
    jobId: "render-job-1",
    lyricVideoId: "video-1",
    userId: "user-1",
    createdAt: Date.now(),
  };
}

function createRenderingRow(overrides: Partial<LyricVideoRow> = {}): LyricVideoRow {
  return {
    ...baseRow,
    status: "rendering",
    durationSeconds: 60,
    lyricsJson: {
      lines: [{ id: "line-1", start: 0, end: 1, text: "Hello" }],
    },
    ...overrides,
  };
}

function createRenderBucket(options: {
  audioObject?: R2ObjectBody | null;
  outputHeads?: Array<R2Object | null>;
  putError?: Error;
} = {}) {
  const audioObject = options.audioObject === undefined
    ? {
        body: new ReadableStream<Uint8Array>(),
        httpMetadata: { contentType: "audio/mpeg" },
      } as R2ObjectBody
    : options.audioObject;

  const head = vi.fn();
  for (const outputHead of options.outputHeads ?? [null]) {
    head.mockResolvedValueOnce(outputHead);
  }

  return {
    get: vi.fn().mockResolvedValue(audioObject),
    put: options.putError
      ? vi.fn().mockRejectedValue(options.putError)
      : vi.fn().mockResolvedValue(undefined),
    head,
    delete: vi.fn(),
  };
}

function createOutputObject(customMetadata: Record<string, string> = {
  renderJobId: "render-job-1",
  renderProvider: "fake-video-provider",
}): R2Object {
  return {
    size: 128,
    httpMetadata: { contentType: "video/mp4" },
    customMetadata,
  } as unknown as R2Object;
}

function createFakeProvider(options: {
  name?: string;
  error?: Error;
} = {}): RenderLyricVideoProvider & { render: ReturnType<typeof vi.fn> } {
  const render = vi.fn(async () => {
    if (options.error) {
      throw options.error;
    }
    return {
      kind: "dry-run" as const,
      provider: "development-stub-render" as const,
    };
  });

  return {
    name: options.name ?? "fake-render-provider",
    render,
  };
}

function createVideoProvider(
  body = new ReadableStream<Uint8Array>(),
): RenderLyricVideoProvider & { render: ReturnType<typeof vi.fn> } {
  const render = vi.fn(async () => ({
    kind: "video" as const,
    provider: "fake-video-provider",
    body,
    contentType: "video/mp4" as const,
  }));

  return {
    name: "fake-video-provider",
    render,
  };
}

function createDbForExistingVideo(row: typeof baseRow, updates: unknown[]) {
  return createDbForVideoSequence([row], updates);
}

function createDbForMissingVideo(updates: unknown[]) {
  return createDbForVideoSequence([], updates);
}

function createDbWithUpdateFailure(row: LyricVideoRow, error: Error) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: vi.fn().mockResolvedValue([row]),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: vi.fn().mockRejectedValue(error),
      }),
    }),
  };
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
