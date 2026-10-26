ALTER TABLE "vision_settings" ADD COLUMN "max_response_tokens" integer;--> statement-breakpoint
ALTER TABLE "vision_settings" ADD COLUMN "image_detail" text;--> statement-breakpoint
ALTER TABLE "vision_settings" ADD COLUMN "temperature" double precision;--> statement-breakpoint
ALTER TABLE "vision_settings" ADD CONSTRAINT "vision_settings_image_detail" CHECK ("image_detail" in ('auto', 'low', 'high'));--> statement-breakpoint
ALTER TABLE "vision_settings" ADD CONSTRAINT "vision_settings_max_response_tokens" CHECK ("max_response_tokens" > 0);--> statement-breakpoint
ALTER TABLE "vision_settings" ADD CONSTRAINT "vision_settings_temperature" CHECK ("temperature" between 0 and 2);