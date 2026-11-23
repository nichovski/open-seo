CREATE TABLE IF NOT EXISTS `pageduel_connections` (
	`project_id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`site_name` text NOT NULL,
	`site_domain` text NOT NULL,
	`api_key_ciphertext` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
