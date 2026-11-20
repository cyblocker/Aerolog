CREATE TABLE IF NOT EXISTS `owner_profile` (
  `id` integer PRIMARY KEY NOT NULL,
  `citizenships` text,
  `residency_country` text,
  `residency_status` text,
  `visas_and_programs` text,
  `frequent_flyer_statuses` text,
  `meal_preferences` text,
  `home_timezone` text,
  `daily_reminder_hour` integer,
  `updated_at` integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `flight_reminders` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `flight_id` integer REFERENCES `flights`(`id`) ON DELETE CASCADE,
  `category` text DEFAULT 'custom' NOT NULL,
  `title` text NOT NULL,
  `details` text,
  `action_url` text,
  `granularity` text DEFAULT 'day' NOT NULL,
  `event_at_utc` text,
  `remind_at_utc` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `source` text DEFAULT 'manual' NOT NULL,
  `notified_at` text,
  `completed_at` text,
  `created_at` integer,
  `updated_at` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_flight_reminders_due` ON `flight_reminders` (`status`, `notified_at`, `remind_at_utc`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_flight_reminders_flight` ON `flight_reminders` (`flight_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_flights_date` ON `flights` (`flight_date`);
