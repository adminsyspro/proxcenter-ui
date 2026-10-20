ALTER TABLE "audit_logs" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'app';
CREATE INDEX "audit_logs_source_timestamp_idx" ON "audit_logs"("source", "timestamp");
