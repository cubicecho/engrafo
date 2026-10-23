CREATE TYPE "field_source" AS ENUM('extracted', 'user');--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "document_date" date;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "document_date_source" "field_source";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "vendor" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "total" numeric;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "receipt_source" "field_source";--> statement-breakpoint
CREATE INDEX "idx_documents_user_document_date" ON "documents" ("user_id","document_date");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "ck_documents_currency" CHECK ("currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "ck_documents_total" CHECK ("total" >= 0);