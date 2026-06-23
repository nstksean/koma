CREATE TABLE `access_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`disabled` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_codes_code_hash_unique` ON `access_codes` (`code_hash`);--> statement-breakpoint
CREATE TABLE `tts_usage` (
	`identity` text NOT NULL,
	`day` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`identity`, `day`)
);
