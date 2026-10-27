ALTER TABLE "vision_settings" ADD COLUMN "top_p" double precision;--> statement-breakpoint
ALTER TABLE "vision_settings" ADD COLUMN "top_k" integer;--> statement-breakpoint
ALTER TABLE "vision_settings" ADD COLUMN "min_p" double precision;--> statement-breakpoint
ALTER TABLE "vision_settings" ADD COLUMN "presence_penalty" double precision;--> statement-breakpoint
ALTER TABLE "vision_settings" ADD COLUMN "frequency_penalty" double precision;--> statement-breakpoint
ALTER TABLE "vision_settings" ADD COLUMN "repeat_penalty" double precision;--> statement-breakpoint
ALTER TABLE "vision_settings" ADD CONSTRAINT "vision_settings_top_p" CHECK ("top_p" between 0 and 1);--> statement-breakpoint
ALTER TABLE "vision_settings" ADD CONSTRAINT "vision_settings_top_k" CHECK ("top_k" >= 0);--> statement-breakpoint
ALTER TABLE "vision_settings" ADD CONSTRAINT "vision_settings_min_p" CHECK ("min_p" between 0 and 1);--> statement-breakpoint
ALTER TABLE "vision_settings" ADD CONSTRAINT "vision_settings_presence_penalty" CHECK ("presence_penalty" between -2 and 2);--> statement-breakpoint
ALTER TABLE "vision_settings" ADD CONSTRAINT "vision_settings_frequency_penalty" CHECK ("frequency_penalty" between -2 and 2);--> statement-breakpoint
ALTER TABLE "vision_settings" ADD CONSTRAINT "vision_settings_repeat_penalty" CHECK ("repeat_penalty" between 0 and 2);