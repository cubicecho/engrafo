CREATE TABLE "folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "folder_id" uuid;--> statement-breakpoint
CREATE INDEX "idx_documents_folder_id" ON "documents" ("folder_id");--> statement-breakpoint
-- A title is now also the document's name in its folder: it may not hold a `/`
-- (the tree would split it into folders) and is unique there, ignoring case.
-- Every existing document is at the top level, so a clash is any two of one
-- user's titles. The oldest keeps its title and the rest gain " (2)", " (3)",
-- skipping any number a title already has.
UPDATE "documents" SET "title" = replace("title", '/', '-') WHERE "title" LIKE '%/%';--> statement-breakpoint
DO $$
DECLARE
  clash record;
  n integer;
  candidate text;
BEGIN
  FOR clash IN
    SELECT "id", "user_id", "title" FROM (
      SELECT "id", "user_id", "title",
        row_number() OVER (PARTITION BY "user_id", lower("title") ORDER BY "created_at", "id") AS rank
      FROM "documents"
    ) ranked
    WHERE rank > 1
  LOOP
    n := 2;
    LOOP
      candidate := clash."title" || ' (' || n || ')';
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM "documents" WHERE "user_id" = clash."user_id" AND lower("title") = lower(candidate)
      );
      n := n + 1;
    END LOOP;
    UPDATE "documents" SET "title" = candidate WHERE "id" = clash."id";
  END LOOP;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_documents_user_folder_title" ON "documents" ("user_id",coalesce("folder_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("title"));--> statement-breakpoint
CREATE UNIQUE INDEX "uq_folders_user_parent_name" ON "folders" ("user_id",coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("name"));--> statement-breakpoint
CREATE INDEX "idx_folders_user_id" ON "folders" ("user_id");--> statement-breakpoint
CREATE INDEX "idx_folders_parent_id" ON "folders" ("parent_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_folder_id_folders_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "folders"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_parent_id_folders_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "folders"("id") ON DELETE CASCADE;