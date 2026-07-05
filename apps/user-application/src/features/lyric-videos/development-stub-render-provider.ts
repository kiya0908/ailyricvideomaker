import type { RenderLyricVideoProvider } from "./render-provider";

const DEVELOPMENT_STUB_RENDER_PROVIDER = "development-stub-render" as const;

export function createDevelopmentStubRenderProvider(): RenderLyricVideoProvider {
  return {
    name: DEVELOPMENT_STUB_RENDER_PROVIDER,
    async render() {
      return {
        kind: "dry-run",
        provider: DEVELOPMENT_STUB_RENDER_PROVIDER,
      };
    },
  };
}
