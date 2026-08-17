ALTER TABLE `books` ADD `slug` text;
--> statement-breakpoint
ALTER TABLE `books` ADD `cover_url` text;
--> statement-breakpoint
ALTER TABLE `books` ADD `cover_width` integer;
--> statement-breakpoint
ALTER TABLE `books` ADD `cover_height` integer;
--> statement-breakpoint
ALTER TABLE `books` ADD `release_year` integer;
--> statement-breakpoint
ALTER TABLE `books` ADD `pages` integer;
--> statement-breakpoint
ALTER TABLE `books` ADD `community_rating` real;
--> statement-breakpoint
ALTER TABLE `books` ADD `ratings_count` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `books` ADD `series_json` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `profile_books` ADD `user_rating` real;
--> statement-breakpoint
ALTER TABLE `profile_books` ADD `first_read_date` text;
--> statement-breakpoint
ALTER TABLE `profile_books` ADD `last_read_date` text;
