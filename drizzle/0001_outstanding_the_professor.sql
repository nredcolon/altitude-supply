CREATE TABLE `catalog_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`invite_hash` text NOT NULL,
	`invite_expires_at` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_workspaces_owner_id_unique` ON `catalog_workspaces` (`owner_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_workspaces_invite_hash_unique` ON `catalog_workspaces` (`invite_hash`);