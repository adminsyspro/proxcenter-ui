-- Failed sign-in counters and lockouts, per account and per client IP.
CREATE TABLE "login_throttles" (
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "failed_count" INTEGER NOT NULL,
    "first_failed_at" TIMESTAMP(3) NOT NULL,
    "last_failed_at" TIMESTAMP(3) NOT NULL,
    "locked_until" TIMESTAMP(3),

    CONSTRAINT "login_throttles_pkey" PRIMARY KEY ("kind","key"),
    CONSTRAINT "login_throttles_kind_check" CHECK ("kind" IN ('account', 'ip'))
);

CREATE INDEX "login_throttles_locked_until_idx" ON "login_throttles"("locked_until");

CREATE INDEX "login_throttles_last_failed_at_idx" ON "login_throttles"("last_failed_at");

-- Per source IP threshold (0 = no IP lockout) and the number of reverse
-- proxies whose X-Forwarded-For hops are trusted to find the client IP.
ALTER TABLE "security_policies"
  ADD COLUMN "login_ip_max_failed_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "login_trusted_proxies" INTEGER NOT NULL DEFAULT 1;
