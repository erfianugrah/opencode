CREATE TABLE `memory` (
	`id` text PRIMARY KEY,
	`content` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `memory_time_created_idx` ON `memory` (`time_created`);