export type LyricVideoStatus =
  | "uploaded"
  | "transcribing"
  | "ready-for-edit"
  | "rendering"
  | "ready"
  | "failed";

export type LyricVideoFailureStage =
  | "upload"
  | "transcription"
  | "render"
  | "storage"
  | "unknown";

export type LyricLine = {
  id: string;
  start: number;
  end: number;
  text: string;
};

export type LyricsJson = {
  lines: LyricLine[];
};

export type TemplateConfig = {
  backgroundType: "color" | "image";
  backgroundValue: string;
  fontFamily: string;
  fontColor: string;
  fontSize: number;
  animationStyle: "fade" | "karaoke" | "scroll";
  aspectRatio: "16:9" | "9:16" | "1:1";
};

export type LyricVideo = {
  id: string;
  userId: string;
  title: string;
  audioFileUrl: string;
  audioObjectKey: string | null;
  lyricsJson: LyricsJson;
  templateConfig: TemplateConfig;
  status: LyricVideoStatus;
  outputVideoUrl: string | null;
  outputObjectKey: string | null;
  errorMessage: string | null;
  failureStage: LyricVideoFailureStage | null;
  transcriptionProvider: string | null;
  transcriptionJobId: string | null;
  renderProvider: string | null;
  renderJobId: string | null;
  fileSizeBytes: number | null;
  durationSeconds: number | null;
  createdAt: number;
  updatedAt: number;
};
