ALTER TABLE "vision_settings" ADD COLUMN "prompt" text;--> statement-breakpoint
ALTER TABLE "vision_settings" ADD CONSTRAINT "vision_settings_prompt" CHECK ("prompt" <> '');