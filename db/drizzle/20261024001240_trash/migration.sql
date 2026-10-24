ALTER TABLE "documents" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
DROP INDEX "uq_documents_user_folder_title";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_documents_user_folder_title" ON "documents" ("user_id",coalesce("folder_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("title")) WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "idx_documents_user_deleted_at" ON "documents" ("user_id","deleted_at");