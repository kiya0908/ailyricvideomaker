import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LyricsJson, TemplateConfig } from "./types";

export async function renderLyricVideoWithFfmpeg(input: {
  audioPath: string;
  lyrics: LyricsJson;
  template: TemplateConfig;
  outputPath: string;
}) {
  const tempDir = await mkdtemp(join(tmpdir(), "lyric-video-"));
  const subtitlesPath = join(tempDir, "lyrics.ass");

  try {
    await writeFile(subtitlesPath, createAssSubtitles(input.lyrics, input.template));
    await runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      createBackgroundInput(input.template),
      "-i",
      input.audioPath,
      "-vf",
      `ass=${escapeFfmpegPath(subtitlesPath)}`,
      "-shortest",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      "-pix_fmt",
      "yuv420p",
      input.outputPath,
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function createAssSubtitles(lyrics: LyricsJson, template: TemplateConfig) {
  const fontSize = Math.round(template.fontSize);
  const lines = lyrics.lines
    .map(
      (line) =>
        `Dialogue: 0,${formatAssTime(line.start)},${formatAssTime(line.end)},Default,,0,0,0,,${line.text.replace(/\n/g, " ")}`,
    )
    .join("\n");

  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${template.fontFamily},${fontSize},&H00FFFFFF,&H000000FF,&H99000000,&H66000000,0,0,0,0,100,100,0,0,1,2,0,2,80,80,120,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${lines}
`;
}

function createBackgroundInput(template: TemplateConfig) {
  const size =
    template.aspectRatio === "9:16"
      ? "1080x1920"
      : template.aspectRatio === "1:1"
        ? "1080x1080"
        : "1920x1080";
  const color = template.backgroundType === "color" ? template.backgroundValue : "#111827";
  return `color=c=${color}:s=${size}:r=30`;
}

function formatAssTime(seconds: number) {
  const centiseconds = Math.max(0, Math.round(seconds * 100));
  const cs = centiseconds % 100;
  const totalSeconds = Math.floor(centiseconds / 100);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function escapeFfmpegPath(path: string) {
  return path.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
}

function runFfmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });
}
