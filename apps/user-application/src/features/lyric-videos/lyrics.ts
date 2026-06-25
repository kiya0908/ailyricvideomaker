import type { LyricLine, LyricsJson, TemplateConfig } from "./types";

export const defaultTemplateConfig: TemplateConfig = {
  backgroundType: "color",
  backgroundValue: "#111827",
  fontFamily: "Geist",
  fontColor: "#f8fafc",
  fontSize: 56,
  animationStyle: "fade",
  aspectRatio: "16:9",
};

export const emptyLyricsJson: LyricsJson = {
  lines: [],
};

export function normalizeLyricLines(lines: LyricLine[]): LyricLine[] {
  return lines
    .map((line) => ({
      ...line,
      text: normalizeText(line.text),
      start: normalizeTime(line.start),
      end: normalizeTime(line.end),
    }))
    .filter((line) => line.text.length > 0)
    .map((line) => ({
      ...line,
      end: line.end > line.start ? line.end : line.start + 0.5,
    }));
}

export function normalizeLyricsJson(lyrics: LyricsJson): LyricsJson {
  return {
    lines: normalizeLyricLines(lyrics.lines),
  };
}

function normalizeText(text: string) {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) {
    return "";
  }
  if (trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed)) {
    return trimmed
      .toLowerCase()
      .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
  }
  return trimmed;
}

function normalizeTime(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.round(value * 1000) / 1000;
}
