CREATE TYPE "merge_suggestion_status" AS ENUM('open', 'dismissed', 'merged');--> statement-breakpoint
CREATE TABLE "merge_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"document_ids" uuid[] NOT NULL,
	"member_key" text NOT NULL,
	"confidence" double precision NOT NULL,
	"reasons" jsonb DEFAULT '[]' NOT NULL,
	"ai_checked" boolean DEFAULT false NOT NULL,
	"status" "merge_suggestion_status" DEFAULT 'open'::"merge_suggestion_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_merge_suggestions_user_member_key" ON "merge_suggestions" ("user_id","member_key");--> statement-breakpoint
CREATE INDEX "idx_merge_suggestions_user_status" ON "merge_suggestions" ("user_id","status");--> statement-breakpoint
ALTER TABLE "merge_suggestions" ADD CONSTRAINT "merge_suggestions_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;