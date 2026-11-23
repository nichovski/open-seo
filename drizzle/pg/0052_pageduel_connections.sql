CREATE TABLE IF NOT EXISTS "pageduel_connections" (
	"project_id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"site_name" text NOT NULL,
	"site_domain" text NOT NULL,
	"api_key_ciphertext" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "pageduel_connections" ADD CONSTRAINT "pageduel_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;