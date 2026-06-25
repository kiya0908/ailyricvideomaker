CREATE TABLE `lyric_videos` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`audio_file_url` text NOT NULL,
	`lyrics_json` text NOT NULL,
	`template_config` text NOT NULL,
	`status` text NOT NULL,
	`output_video_url` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lyric_videos_user_id_idx` ON `lyric_videos` (`user_id`);--> statement-breakpoint
CREATE INDEX `lyric_videos_status_idx` ON `lyric_videos` (`status`);
