-- Repurpose the never-used `sessions` table as the real session store:
-- revocation, idle timeout and absolute cap. Created by
-- 20260504144606_init_postgres in NextAuth-adapter shape and never read or
-- written by any code, so it is empty in every deployment; dropping columns
-- and adding NOT NULL columns without a default are both safe here.
DROP INDEX "sessions_token_key";
DROP INDEX "sessions_token_idx";
DROP INDEX "sessions_expires_at_idx";

ALTER TABLE "sessions" DROP COLUMN "token";
ALTER TABLE "sessions" DROP COLUMN "expires_at";

ALTER TABLE "sessions" ADD COLUMN "last_seen_at" TIMESTAMP(3) NOT NULL;
ALTER TABLE "sessions" ADD COLUMN "revoked_at" TIMESTAMP(3);

CREATE INDEX "sessions_last_seen_at_idx" ON "sessions"("last_seen_at");
