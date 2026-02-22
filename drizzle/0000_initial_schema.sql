CREATE TABLE `series` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`source` text NOT NULL,
	`cover_page_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chapters` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`title` text NOT NULL,
	`chapter_number` integer NOT NULL,
	`sort_index` integer NOT NULL,
	`page_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chapters_series_sort_index_idx` ON `chapters` (`series_id`,`sort_index`);
--> statement-breakpoint
CREATE TABLE `pages` (
	`id` text PRIMARY KEY NOT NULL,
	`chapter_id` text NOT NULL,
	`page_index` integer NOT NULL,
	`image_path` text NOT NULL,
	`thumbnail_path` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`aspect` real NOT NULL,
	`auto_is_spread` integer DEFAULT false NOT NULL,
	`user_override_spread` integer,
	`split_spread` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pages_chapter_page_index_idx` ON `pages` (`chapter_id`,`page_index`);
--> statement-breakpoint
CREATE TABLE `reading_progress` (
	`profile_id` text DEFAULT 'local' NOT NULL,
	`chapter_id` text NOT NULL,
	`page_index` integer DEFAULT 0 NOT NULL,
	`step_index` integer DEFAULT 0 NOT NULL,
	`mode` text DEFAULT 'single' NOT NULL,
	`direction` text DEFAULT 'rtl' NOT NULL,
	`zoom_preset` text DEFAULT 'fit-height' NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`profile_id`,`chapter_id`),
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade
);
