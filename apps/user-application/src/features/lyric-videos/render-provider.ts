import { createDevelopmentStubRenderProvider } from "./development-stub-render-provider";
import type { LyricsJson, TemplateConfig } from "./types";

export const NOT_CONFIGURED_RENDER_PROVIDER = "not-configured";
export const DEVELOPMENT_STUB_RENDER_PROVIDER = "development-stub-render";

export type RenderLyricVideoInput = {
  lyricVideoId: string;
  userId: string;
  idempotencyKey: string;
  audio: {
    objectKey: string;
    body: ReadableStream<Uint8Array>;
    contentType: string;
  };
  lyricsJson: LyricsJson;
  templateConfig: TemplateConfig;
  title: string;
  durationSeconds: number | null;
};

export type RenderLyricVideoResult =
  | {
      kind: "video";
      provider: string;
      body: ReadableStream<Uint8Array>;
      contentType: "video/mp4";
      durationSeconds?: number;
    }
  | {
      kind: "dry-run";
      provider: typeof DEVELOPMENT_STUB_RENDER_PROVIDER;
    };

export interface RenderLyricVideoProvider {
  readonly name: string;
  render(input: RenderLyricVideoInput): Promise<RenderLyricVideoResult>;
}

export type RenderProviderEnv = {
  LYRIC_VIDEO_RENDER_PROVIDER?: string;
};

export class RenderTerminalProviderError extends Error {
  override readonly name = "RenderTerminalProviderError";
}

export class RenderInfrastructureProviderError extends Error {
  override readonly name = "RenderInfrastructureProviderError";
}

export function getRenderLyricVideoProvider(
  env: RenderProviderEnv,
): RenderLyricVideoProvider {
  if (env.LYRIC_VIDEO_RENDER_PROVIDER === DEVELOPMENT_STUB_RENDER_PROVIDER) {
    return createDevelopmentStubRenderProvider();
  }

  return {
    name: NOT_CONFIGURED_RENDER_PROVIDER,
    async render() {
      throw new RenderTerminalProviderError("Render provider is not configured");
    },
  };
}
