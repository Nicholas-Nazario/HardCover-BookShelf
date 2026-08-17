CREATE TABLE `profiles` (
	`hardcover_user_id` integer PRIMARY KEY NOT NULL,
	`username` text COLLATE NOCASE NOT NULL,
	`display_name` text,
	`books_count` integer NOT NULL,
	`privacy_setting_id` integer NOT NULL,
	`last_synced_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `profiles_privacy_setting_check` CHECK (`profiles`.`privacy_setting_id` = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_username_unique` ON `profiles` (`username`);
--> statement-breakpoint
CREATE TABLE `books` (
	`hardcover_book_id` integer PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`authors_json` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profile_books` (
	`hardcover_user_id` integer NOT NULL,
	`hardcover_book_id` integer NOT NULL,
	`hardcover_user_book_id` integer NOT NULL,
	`status_id` integer NOT NULL,
	PRIMARY KEY(`hardcover_user_id`, `hardcover_book_id`),
	FOREIGN KEY (`hardcover_user_id`) REFERENCES `profiles`(`hardcover_user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`hardcover_book_id`) REFERENCES `books`(`hardcover_book_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `profile_books_status_check` CHECK (`profile_books`.`status_id` in (1, 3))
);
--> statement-breakpoint
CREATE INDEX `profile_books_profile_status_idx` ON `profile_books` (`hardcover_user_id`,`status_id`);
