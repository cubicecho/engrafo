ALTER TABLE "processing_steps" DROP CONSTRAINT "uq_processing_steps_document_step";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_email_key";--> statement-breakpoint
ALTER TABLE "processing_steps" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_processing_steps_document_step" ON "processing_steps" ("document_id","step");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_users_email" ON "users" ("email");