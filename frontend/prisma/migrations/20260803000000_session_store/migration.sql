-- Repurpose the never-used `sessions` table as the real session store:
-- revocation, idle timeout and absolute cap. Created by
-- 20260504144606_init_postgres in NextAuth-adapter shape and never read or
-- written by any code, so it is empty in every deployment; dropping columns
-- and adding NOT NULL columns without a default are both safe here.
-- The DELETE below is a deliberate guard, not dead code: this migration runs
-- unattended via docker-entrypoint.sh -> scripts/migrate-with-lock.js before
-- the app boots, so a NOT NULL ADD COLUMN with no DEFAULT would fail the
-- container start on any deployment that somehow has rows (hand-inserted, or
-- a brief historical use of the NextAuth adapter). Any such row is unusable
-- anyway, since it is keyed by the `token` column dropped right below, and
-- no code has ever read it. Do not remove this DELETE as redundant.
DROP INDEX "sessions_token_key";
DROP INDEX "sessions_token_idx";
DROP INDEX "sessions_expires_at_idx";

ALTER TABLE "sessions" DROP COLUMN "token";
ALTER TABLE "sessions" DROP COLUMN "expires_at";

DELETE FROM "sessions";

ALTER TABLE "sessions" ADD COLUMN "last_seen_at" TIMESTAMP(3) NOT NULL;
ALTER TABLE "sessions" ADD COLUMN "revoked_at" TIMESTAMP(3);

CREATE INDEX "sessions_last_seen_at_idx" ON "sessions"("last_seen_at");
