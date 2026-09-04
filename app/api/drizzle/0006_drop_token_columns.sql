DELETE FROM `relation_notes`;
--> statement-breakpoint
DELETE FROM `private_relations`;
--> statement-breakpoint
DELETE FROM `events`;
--> statement-breakpoint
DELETE FROM `relations`;
--> statement-breakpoint
DELETE FROM `characters`;
--> statement-breakpoint
DELETE FROM `projects`;
--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `owner_token_hash`;
--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `transfer_code_hash`;
--> statement-breakpoint
ALTER TABLE `characters` DROP COLUMN `edit_token_hash`;
