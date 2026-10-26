CREATE TYPE "content_format" AS ENUM('plain', 'markdown');--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "content_format" "content_format" DEFAULT 'plain'::"content_format" NOT NULL;--> statement-breakpoint
ALTER TABLE "vision_settings" ADD COLUMN "text_format" "content_format";--> statement-breakpoint
-- Text written before this column existed: these types were already stored with headings.
UPDATE "documents" SET "content_format" = 'markdown' WHERE "mime_type" IN ('text/markdown', 'application/epub+zip', 'text/html');