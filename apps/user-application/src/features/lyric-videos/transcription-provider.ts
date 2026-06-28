import type { LyricsJson } from "./types";

type TranscriptionProviderName = "development-stub" | "workers-ai-whisper";

export type TranscriptionProviderInput = {
  audioObjectKey?: string | null;
  audioFileUrl: string;
  env: Env;
  lyricVideoId: string;
  provider?: string | null;
  userId: string;
};

export type TranscriptionProviderResult = {
  lyricsJson: LyricsJson;
  provider: string;
  providerJobId?: string;
  durationSeconds?: number;
};

type WhisperResult = {
  text?: unknown;
  words?: unknown;
  vtt?: unknown;
};

type WorkersAiBinding = {
  run: (model: string, input: { audio: number[] }) => Promise<WhisperResult>;
};

type TranscriptionProviderEnv = Env & {
  AI?: WorkersAiBinding;
  LYRIC_VIDEO_BUCKET?: R2Bucket;
  LYRIC_VIDEO_TRANSCRIPTION_PROVIDER?: string;
};

const DEVELOPMENT_TRANSCRIPTION_PROVIDER = "development-stub";
const WORKERS_AI_WHISPER_PROVIDER = "workers-ai-whisper";
const WORKERS_AI_WHISPER_MODEL = "@cf/openai/whisper";
const WORD_LINE_GAP_SECONDS = 1.5;
const FALLBACK_LINE_SECONDS = 3;

export class TranscriptionInfrastructureError extends Error {
  override name = "TranscriptionInfrastructureError";
}

export async function transcribeLyricVideoAudio(
  input: TranscriptionProviderInput,
): Promise<TranscriptionProviderResult> {
  const provider = input.provider
    ? parseTranscriptionProviderName(input.provider)
    : getConfiguredTranscriptionProviderName(input.env);

  switch (provider) {
    case "development-stub":
      return transcribeWithDevelopmentStub(input);
    case "workers-ai-whisper":
      return transcribeWithWorkersAiWhisper(input);
  }
}

export function convertWhisperResultToLyricsJson(result: WhisperResult): LyricsJson {
  const fromWords = convertWordsToLyricsJson(result.words);
  if (fromWords.lines.length > 0) {
    return fromWords;
  }

  const fromVtt = convertVttToLyricsJson(result.vtt);
  if (fromVtt.lines.length > 0) {
    return fromVtt;
  }

  const fromText = convertTextToLyricsJson(result.text);
  if (fromText.lines.length > 0) {
    return fromText;
  }

  throw new Error("Workers AI Whisper returned no usable transcription text");
}

export function getConfiguredTranscriptionProviderName(env: Env): TranscriptionProviderName {
  const provider = (env as TranscriptionProviderEnv).LYRIC_VIDEO_TRANSCRIPTION_PROVIDER?.trim();
  if (!provider || provider === DEVELOPMENT_TRANSCRIPTION_PROVIDER) {
    return DEVELOPMENT_TRANSCRIPTION_PROVIDER;
  }
  return parseTranscriptionProviderName(provider);
}

function parseTranscriptionProviderName(provider: string): TranscriptionProviderName {
  if (
    provider === DEVELOPMENT_TRANSCRIPTION_PROVIDER ||
    provider === WORKERS_AI_WHISPER_PROVIDER
  ) {
    return provider;
  }
  throw new Error(`Unsupported lyric video transcription provider: ${provider}`);
}

async function transcribeWithDevelopmentStub(
  input: TranscriptionProviderInput,
): Promise<TranscriptionProviderResult> {
  void input.audioObjectKey;
  void input.audioFileUrl;
  void input.env;
  void input.lyricVideoId;
  void input.userId;

  return {
    provider: DEVELOPMENT_TRANSCRIPTION_PROVIDER,
    lyricsJson: {
      lines: [
        { id: crypto.randomUUID(), start: 0, end: 3.2, text: "Waiting for the first beat" },
        { id: crypto.randomUUID(), start: 3.2, end: 7.4, text: "Lights rise over the chorus" },
        { id: crypto.randomUUID(), start: 7.4, end: 11.8, text: "Every line lands on time" },
      ],
    },
  };
}

async function transcribeWithWorkersAiWhisper(
  input: TranscriptionProviderInput,
): Promise<TranscriptionProviderResult> {
  const env = input.env as TranscriptionProviderEnv;
  if (!input.audioObjectKey) {
    throw new Error("audioObjectKey is required for Workers AI Whisper transcription");
  }
  if (!env.LYRIC_VIDEO_BUCKET) {
    throw new Error("LYRIC_VIDEO_BUCKET binding is not configured");
  }
  if (!env.AI) {
    throw new Error("AI binding is not configured");
  }

  let audioObject: R2ObjectBody | null;
  try {
    audioObject = await env.LYRIC_VIDEO_BUCKET.get(input.audioObjectKey);
  } catch {
    throw new TranscriptionInfrastructureError(
      "R2 audio read failed before transcription",
    );
  }
  if (!audioObject) {
    throw new Error("Audio object was not found in R2 for transcription");
  }

  let audioBuffer: ArrayBuffer;
  try {
    audioBuffer = await audioObject.arrayBuffer();
  } catch {
    throw new TranscriptionInfrastructureError(
      "R2 audio body read failed before transcription",
    );
  }

  let response: WhisperResult;
  try {
    response = await env.AI.run(WORKERS_AI_WHISPER_MODEL, {
      audio: [...new Uint8Array(audioBuffer)],
    });
  } catch {
    throw new Error("Workers AI transcription failed");
  }

  const durationSeconds = inferWhisperDurationSeconds(response);
  return {
    provider: WORKERS_AI_WHISPER_PROVIDER,
    lyricsJson: convertWhisperResultToLyricsJson(response),
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
  };
}

function inferWhisperDurationSeconds(result: WhisperResult) {
  if (Array.isArray(result.words)) {
    const wordEnd = result.words.reduce((maximum, word) => {
      const normalized = normalizeWhisperWord(word);
      return normalized ? Math.max(maximum, normalized.end) : maximum;
    }, 0);
    if (wordEnd > 0) {
      return Math.ceil(wordEnd);
    }
  }

  if (typeof result.vtt !== "string") {
    return undefined;
  }

  const vttEnd = result.vtt
    .replace(/\r/g, "")
    .split("\n")
    .reduce((maximum, line) => {
      if (!line.includes("-->")) {
        return maximum;
      }
      const rawEnd = line.split("-->")[1]?.trim().split(/\s+/)[0] ?? "";
      const end = parseVttTimestamp(rawEnd);
      return end === null ? maximum : Math.max(maximum, end);
    }, 0);

  return vttEnd > 0 ? Math.ceil(vttEnd) : undefined;
}

function convertWordsToLyricsJson(words: unknown): LyricsJson {
  if (!Array.isArray(words)) {
    return { lines: [] };
  }

  const normalizedWords = words
    .map((word) => normalizeWhisperWord(word))
    .filter((word): word is { text: string; start: number; end: number } => word !== null);

  if (normalizedWords.length === 0) {
    return { lines: [] };
  }

  const lines: Array<{ start: number; end: number; words: string[] }> = [];
  for (const word of normalizedWords) {
    const current = lines[lines.length - 1];
    if (!current || word.start - current.end > WORD_LINE_GAP_SECONDS) {
      lines.push({ start: word.start, end: word.end, words: [word.text] });
    } else {
      current.end = word.end;
      current.words.push(word.text);
    }
  }

  return {
    lines: lines.map((line) => ({
      id: crypto.randomUUID(),
      start: line.start,
      end: line.end,
      text: line.words.join(" ").trim(),
    })),
  };
}

function normalizeWhisperWord(
  value: unknown,
): { text: string; start: number; end: number } | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const textValue = record.word ?? record.text;
  const text = typeof textValue === "string" ? textValue.trim() : "";
  const start = toFiniteNumber(record.start);
  const end = toFiniteNumber(record.end);

  if (!text || start === null || end === null || end <= start) {
    return null;
  }

  return { text, start, end };
}

function convertVttToLyricsJson(vtt: unknown): LyricsJson {
  if (typeof vtt !== "string" || !vtt.trim()) {
    return { lines: [] };
  }

  const lines = vtt.replace(/\r/g, "").split("\n");
  const lyricLines: LyricsJson["lines"] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (!line.includes("-->")) {
      continue;
    }

    const [rawStart = "", rawEnd = ""] = line.split("-->").map((part) => part.trim());
    const start = parseVttTimestamp(rawStart);
    const end = parseVttTimestamp(rawEnd.split(/\s+/)[0] ?? "");
    if (start === null || end === null || end <= start) {
      continue;
    }

    const textLines: string[] = [];
    for (let textIndex = index + 1; textIndex < lines.length; textIndex += 1) {
      const textLine = lines[textIndex]?.trim() ?? "";
      if (!textLine) {
        index = textIndex;
        break;
      }
      if (textLine.includes("-->")) {
        index = textIndex - 1;
        break;
      }
      textLines.push(textLine);
      if (textIndex === lines.length - 1) {
        index = textIndex;
      }
    }

    const text = textLines.join(" ").trim();
    if (text) {
      lyricLines.push({ id: crypto.randomUUID(), start, end, text });
    }
  }

  return { lines: lyricLines };
}

function convertTextToLyricsJson(text: unknown): LyricsJson {
  if (typeof text !== "string" || !text.trim()) {
    return { lines: [] };
  }

  const segments = (text.match(/[^.!?\n]+[.!?]+|[^.!?\n]+/g) ?? [])
    .map((segment) => segment.trim())
    .filter(Boolean);

  return {
    lines: segments.map((segment, index) => ({
      id: crypto.randomUUID(),
      start: index * FALLBACK_LINE_SECONDS,
      end: (index + 1) * FALLBACK_LINE_SECONDS,
      text: segment,
    })),
  };
}

function parseVttTimestamp(value: string): number | null {
  const normalized = value.replace(",", ".");
  const parts = normalized.split(":");
  if (parts.length < 2 || parts.length > 3) {
    return null;
  }

  const seconds = Number(parts[parts.length - 1]);
  const minutes = Number(parts[parts.length - 2]);
  const hours = parts.length === 3 ? Number(parts[0]) : 0;
  if (![seconds, minutes, hours].every(Number.isFinite)) {
    return null;
  }

  return hours * 3600 + minutes * 60 + seconds;
}

function toFiniteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}
