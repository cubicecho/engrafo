-- pgvector, for the search index's embeddings. Needs an image that ships it
-- (pgvector/pgvector:pg17); on a Postgres you run yourself, install the
-- extension and, if this role may not create it, run this line as a superuser.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
-- The compose files move from postgres:17-alpine (musl) to pgvector's Debian
-- image (glibc) in this release. The data directory carries over, but the two
-- order text differently, so a text index built on one is out of order on the
-- other: an email lookup could miss a row that is there. Rebuilding is cheap at
-- this size, and harmless on a database that never moved.
REINDEX TABLE "users";
--> statement-breakpoint
REINDEX TABLE "sessions";
--> statement-breakpoint
REINDEX TABLE "accounts";
--> statement-breakpoint
REINDEX TABLE "verifications";
--> statement-breakpoint
REINDEX TABLE "documents";
--> statement-breakpoint
REINDEX TABLE "processing_steps";
--> statement-breakpoint
REINDEX TABLE "oidc_settings";
--> statement-breakpoint
CREATE TABLE "document_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(384) NOT NULL,
	"embedding_model" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_document_chunks_document_position" ON "document_chunks" ("document_id","position");--> statement-breakpoint
CREATE INDEX "idx_document_chunks_user_id" ON "document_chunks" ("user_id");--> statement-breakpoint
CREATE INDEX "idx_document_chunks_words" ON "document_chunks" USING gin (to_tsvector('simple', "content"));--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_documents_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE;