ALTER TABLE "merge_suggestions" ADD COLUMN "links" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "merge_suggestions" ADD COLUMN "ai_verdicts" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "merge_suggestions" ADD COLUMN "heuristic_confidence" double precision;--> statement-breakpoint
UPDATE "merge_suggestions" SET "heuristic_confidence" = "confidence";--> statement-breakpoint
ALTER TABLE "merge_suggestions" ALTER COLUMN "heuristic_confidence" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "merge_suggestions" DROP COLUMN "ai_checked";
