import { describe, expect, it } from "vitest";
import { normalizeLyricLines } from "./lyrics";
import type { LyricLine } from "./types";

describe("normalizeLyricLines", () => {
  it("trims lyric text, drops blank rows, title-cases shouting rows, and keeps timing order", () => {
    const lines: LyricLine[] = [
      { id: "line-1", start: 5, end: 3, text: "  HELLO FROM THE STAGE  " },
      { id: "line-2", start: 4, end: 8, text: "   " },
      { id: "line-3", start: 9, end: 12, text: " soft lights remain " },
    ];

    const result = normalizeLyricLines(lines);

    expect(result).toEqual([
      { id: "line-1", start: 5, end: 5.5, text: "Hello From The Stage" },
      { id: "line-3", start: 9, end: 12, text: "soft lights remain" },
    ]);
  });
});
