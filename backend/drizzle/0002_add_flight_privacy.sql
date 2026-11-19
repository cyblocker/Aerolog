ALTER TABLE `flights` ADD COLUMN `is_private` integer DEFAULT 0 NOT NULL;
ALTER TABLE `flights` ADD COLUMN `publish_delay_days` integer DEFAULT 5 NOT NULL;
UPDATE `flights` SET `publish_delay_days` = 3 + ((random() & 9223372036854775807) % 5);
