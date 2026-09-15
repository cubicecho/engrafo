CREATE TYPE "document_status" AS ENUM('pending_upload', 'uploaded', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "step_status" AS ENUM('queued', 'running', 'succeeded', 'skipped', 'failed');--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"original_filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum_sha256" text,
	"original_key" text NOT NULL,
	"archive_key" text,
	"content_key" text,
	"content_bytes" bigint,
	"ocr_requested" boolean DEFAULT true NOT NULL,
	"status" "document_status" DEFAULT 'pending_upload'::"document_status" NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processing_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"step" text NOT NULL,
	"position" integer NOT NULL,
	"status" "step_status" DEFAULT 'queued'::"step_status" NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_processing_steps_document_step" UNIQUE("document_id","step")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"email" text NOT NULL UNIQUE,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_documents_user_id" ON "documents" ("user_id");--> statement-breakpoint
CREATE INDEX "idx_documents_user_created" ON "documents" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_documents_user_checksum" ON "documents" ("user_id","checksum_sha256");--> statement-breakpoint
CREATE INDEX "idx_documents_status" ON "documents" ("status");--> statement-breakpoint
CREATE INDEX "idx_processing_steps_user_id" ON "processing_steps" ("user_id");--> statement-breakpoint
CREATE INDEX "idx_processing_steps_document_id" ON "processing_steps" ("document_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "processing_steps" ADD CONSTRAINT "processing_steps_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "processing_steps" ADD CONSTRAINT "processing_steps_document_id_documents_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE;