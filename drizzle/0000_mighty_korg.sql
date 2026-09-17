CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_email_unique` ON `accounts` (`email`);--> statement-breakpoint
CREATE TABLE `analysis_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`status` text NOT NULL,
	`stage` text,
	`done` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`error` text,
	`started_at` text NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `anonymized_points` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`text` text NOT NULL,
	`type` text NOT NULL,
	`option_ids` text NOT NULL,
	`model` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `anonymized_points_event_idx` ON `anonymized_points` (`event_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`title` text NOT NULL,
	`context` text DEFAULT '' NOT NULL,
	`currency` text NOT NULL,
	`state` text DEFAULT 'open' NOT NULL,
	`roster_final` integer DEFAULT false NOT NULL,
	`host_token_hash` text NOT NULL,
	`account_id` text,
	`closes_at` text,
	`closed_at` text,
	`published_at` text,
	`expires_at` text NOT NULL,
	`provider` text,
	`model` text,
	`prompt_version` text,
	`aggregates` text,
	`report` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_code_unique` ON `events` (`code`);--> statement-breakpoint
CREATE TABLE `magic_links` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text
);
--> statement-breakpoint
CREATE TABLE `options` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`position` integer NOT NULL,
	`label` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`cost_per_person` real,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `options_event_idx` ON `options` (`event_id`);--> statement-breakpoint
CREATE TABLE `participants` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`display_name` text NOT NULL,
	`device_token_hash` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `participants_event_device_idx` ON `participants` (`event_id`,`device_token_hash`);--> statement-breakpoint
CREATE TABLE `responses` (
	`participant_id` text PRIMARY KEY NOT NULL,
	`ranking` text NOT NULL,
	`vetoes` text NOT NULL,
	`budget_kind` text,
	`budget_amount` real,
	`opinion` text DEFAULT '' NOT NULL,
	`suggestion` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
