-- API tokens: autonomous read-only service accounts (spec 2026-07-28, #264/#254).
CREATE TABLE "api_tokens" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "token_prefix" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "scopes" JSONB NOT NULL,
  "connection_ids" JSONB,
  "expires_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "last_used_at" TIMESTAMP(3),
  "last_used_ip" TEXT,
  "rate_limit_per_min" INTEGER NOT NULL DEFAULT 600,
  "created_by_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "api_tokens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "api_tokens_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "api_tokens_token_prefix_key" ON "api_tokens"("token_prefix");
CREATE UNIQUE INDEX "api_tokens_token_hash_key" ON "api_tokens"("token_hash");
CREATE INDEX "api_tokens_tenant_id_idx" ON "api_tokens"("tenant_id");

-- Attribute audit rows to a token instead of (falsely) to its creator.
-- Deliberately NO foreign key: audit rows must survive token deletion.
ALTER TABLE "audit_logs" ADD COLUMN "api_token_id" TEXT;
CREATE INDEX "audit_logs_api_token_id_idx" ON "audit_logs"("api_token_id");
