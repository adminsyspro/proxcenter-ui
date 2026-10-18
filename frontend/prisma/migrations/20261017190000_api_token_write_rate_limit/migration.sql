ALTER TABLE "api_tokens" ADD COLUMN "write_rate_limit_per_min" INTEGER NOT NULL DEFAULT 60;
