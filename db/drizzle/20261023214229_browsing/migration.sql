CREATE TABLE "saved_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"query" text,
	"filters" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "thumbnail_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_saved_searches_user_name" ON "saved_searches" ("user_id",lower("name"));--> statement-breakpoint
CREATE INDEX "idx_saved_searches_user_id" ON "saved_searches" ("user_id");--> statement-breakpoint
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;