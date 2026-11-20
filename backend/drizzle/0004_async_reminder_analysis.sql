CREATE TABLE IF NOT EXISTS `flight_analysis_jobs` (
  `flight_id` integer PRIMARY KEY NOT NULL REFERENCES `flights`(`id`) ON DELETE CASCADE,
  `status` text NOT NULL DEFAULT 'queued',
  `force` integer NOT NULL DEFAULT 0,
  `started_at` text,
  `completed_at` text,
  `last_error` text,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_flight_analysis_jobs_status` ON `flight_analysis_jobs` (`status`, `updated_at`);
