import { describe, expect, it } from "vitest";
import { createDevelopmentStubRenderProvider } from "./development-stub-render-provider";
import {
  DEVELOPMENT_STUB_RENDER_PROVIDER,
  getRenderLyricVideoProvider,
  NOT_CONFIGURED_RENDER_PROVIDER,
  RenderInfrastructureProviderError,
  RenderTerminalProviderError,
  type RenderLyricVideoInput,
} from "./render-provider";

const input: RenderLyricVideoInput = {
  lyricVideoId: "video-1",
  userId: "user-1",
  idempotencyKey: "render-job-1",
  audio: {
    objectKey: "lyric-videos/user-1/video-1/audio",
    body: new ReadableStream<Uint8Array>(),
    contentType: "audio/mpeg",
  },
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
    aspectRatio: "9:16",
  },
  title: "Test song",
  durationSeconds: null,
};

describe("getRenderLyricVideoProvider", () => {
  it("fails closed to not-configured when the selector is missing", async () => {
    const provider = getRenderLyricVideoProvider({});

    expect(provider.name).toBe(NOT_CONFIGURED_RENDER_PROVIDER);
    await expect(provider.render(input)).rejects.toBeInstanceOf(
      RenderTerminalProviderError,
    );
  });

  it("fails closed to not-configured for an unknown selector", () => {
    const provider = getRenderLyricVideoProvider({
      LYRIC_VIDEO_RENDER_PROVIDER: "unknown-provider",
    });

    expect(provider.name).toBe(NOT_CONFIGURED_RENDER_PROVIDER);
  });

  it("selects the development stub only when explicitly configured", async () => {
    const provider = getRenderLyricVideoProvider({
      LYRIC_VIDEO_RENDER_PROVIDER: DEVELOPMENT_STUB_RENDER_PROVIDER,
    });

    await expect(provider.render(input)).resolves.toEqual({
      kind: "dry-run",
      provider: DEVELOPMENT_STUB_RENDER_PROVIDER,
    });
  });
});

describe("createDevelopmentStubRenderProvider", () => {
  it("returns a dry-run result without a video body", async () => {
    const provider = createDevelopmentStubRenderProvider();

    const result = await provider.render(input);

    expect(result).toEqual({
      kind: "dry-run",
      provider: DEVELOPMENT_STUB_RENDER_PROVIDER,
    });
    expect(result).not.toHaveProperty("body");
  });
});

describe("render provider errors", () => {
  it("distinguishes terminal and infrastructure failures", () => {
    expect(new RenderTerminalProviderError("terminal").name).toBe(
      "RenderTerminalProviderError",
    );
    expect(new RenderInfrastructureProviderError("infrastructure").name).toBe(
      "RenderInfrastructureProviderError",
    );
  });
});
