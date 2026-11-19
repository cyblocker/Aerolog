CREATE TABLE IF NOT EXISTS `airports` (
	`iata_code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`city` text NOT NULL,
	`country_code` text NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`timezone` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `flights` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`flight_date` text NOT NULL,
	`airline_iata` text NOT NULL,
	`flight_number` text NOT NULL,
	`dep_airport_iata` text NOT NULL,
	`arr_airport_iata` text NOT NULL,
	`dep_time` text,
	`arr_time` text,
	`distance_km` integer,
	`ticket_number` text,
	`booking_ref` text,
	`cabin_class` text,
	`seat` text,
	`aircraft_type` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`notes` text,
	`created_at` integer
);
