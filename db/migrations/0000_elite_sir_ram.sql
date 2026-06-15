CREATE TABLE `books` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`source_book_id` text NOT NULL,
	`title` text NOT NULL,
	`author` text DEFAULT '' NOT NULL,
	`cover` text,
	`intro` text,
	`category` text DEFAULT '' NOT NULL,
	`latest_chapter_title` text,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_books_source_book` ON `books` (`source`,`source_book_id`);--> statement-breakpoint
CREATE TABLE `chapters` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`idx` integer NOT NULL,
	`title` text NOT NULL,
	`source_url` text NOT NULL,
	`content` text,
	`fetched_at` integer,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_chapters_book_idx` ON `chapters` (`book_id`,`idx`);--> statement-breakpoint
CREATE TABLE `library` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text DEFAULT 'local' NOT NULL,
	`book_id` text NOT NULL,
	`added_at` integer NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_library_user_book` ON `library` (`user_id`,`book_id`);--> statement-breakpoint
CREATE TABLE `progress` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text DEFAULT 'local' NOT NULL,
	`book_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`scroll_ratio` real DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_progress_user_book` ON `progress` (`user_id`,`book_id`);