ALTER TABLE `lyric_videos` ADD `audio_object_key` text;--> statement-breakpoint
ALTER TABLE `lyric_videos` ADD `output_object_key` text;--> statement-breakpoint
ALTER TABLE `lyric_videos` ADD `error_message` text;--> statement-breakpoint
ALTER TABLE `lyric_videos` ADD `failure_stage` text;--> statement-breakpoint
ALTER TABLE `lyric_videos` ADD `transcription_provider` text;--> statement-breakpoint
ALTER TABLE `lyric_videos` ADD `transcription_job_id` text;--> statement-breakpoint
ALTER TABLE `lyric_videos` ADD `render_provider` text;--> statement-breakpoint
ALTER TABLE `lyric_videos` ADD `render_job_id` text;--> statement-breakpoint
ALTER TABLE `lyric_videos` ADD `file_size_bytes` integer;--> statement-breakpoint
ALTER TABLE `lyric_videos` ADD `duration_seconds` integer;