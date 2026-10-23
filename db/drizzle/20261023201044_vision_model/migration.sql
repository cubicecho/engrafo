CREATE TABLE "vision_settings" (
	"id" text PRIMARY KEY DEFAULT 'vision',
	"base_url" text,
	"model" text,
	"api_key" text,
	"auto" boolean DEFAULT false NOT NULL,
	"request_timeout_seconds" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vision_settings_singleton" CHECK ("id" = 'vision')
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "vision_requested" boolean DEFAULT false NOT NULL;