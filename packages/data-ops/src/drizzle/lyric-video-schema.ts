import { relations, sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { auth_user } from "./auth-schema";

export const lyricVideos = sqliteTable(
  "lyric_videos",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => auth_user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    audioFileUrl: text("audio_file_url").notNull(),
    audioObjectKey: text("audio_object_key"),
    lyricsJson: text("lyrics_json", { mode: "json" }).notNull(),
    templateConfig: text("template_config", { mode: "json" }).notNull(),
    status: text("status", {
      enum: ["uploaded", "transcribing", "ready-for-edit", "rendering", "ready", "failed"],
    }).notNull(),
    outputVideoUrl: text("output_video_url"),
    outputObjectKey: text("output_object_key"),
    errorMessage: text("error_message"),
    failureStage: text("failure_stage", {
      enum: ["upload", "transcription", "render", "storage", "unknown"],
    }),
    transcriptionProvider: text("transcription_provider"),
    transcriptionJobId: text("transcription_job_id"),
    renderProvider: text("render_provider"),
    renderJobId: text("render_job_id"),
    fileSizeBytes: integer("file_size_bytes"),
    durationSeconds: integer("duration_seconds"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("lyric_videos_user_id_idx").on(table.userId),
    index("lyric_videos_status_idx").on(table.status),
  ],
);

export const lyricVideosRelations = relations(lyricVideos, ({ one }) => ({
  user: one(auth_user, {
    fields: [lyricVideos.userId],
    references: [auth_user.id],
  }),
}));
