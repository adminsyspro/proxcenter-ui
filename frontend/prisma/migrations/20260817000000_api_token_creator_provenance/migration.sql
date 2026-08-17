-- API token creator provenance and offboarding lookup (issue #632).
--
-- `created_by_user_id` is ON DELETE SET NULL: a token deliberately outlives
-- its creator (spec 2026-07-28, decision D3) so that deleting an employee
-- account does not kill the Prometheus integration they set up. The cost was
-- that the row lost all trace of who minted the credential the moment the
-- account went away. `created_by_email` freezes that answer at creation time
-- so provenance survives the delete.
--
-- The index backs the new "tokens created by this user" lookup shown when an
-- admin disables or deletes an account.

ALTER TABLE "api_tokens" ADD COLUMN IF NOT EXISTS "created_by_email" TEXT;

-- Backfill every token whose creator still exists. Rows whose creator was
-- already deleted keep a NULL email: that history is gone and inventing a
-- value would be worse than admitting the gap.
UPDATE "api_tokens" AS t
SET "created_by_email" = u."email"
FROM "users" AS u
WHERE u."id" = t."created_by_user_id"
  AND t."created_by_email" IS NULL;

CREATE INDEX IF NOT EXISTS "api_tokens_created_by_user_id_idx" ON "api_tokens"("created_by_user_id");
