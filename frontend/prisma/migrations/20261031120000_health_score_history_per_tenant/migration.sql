DROP INDEX IF EXISTS "health_score_history_date_key";

CREATE UNIQUE INDEX "health_score_history_tenant_id_date_key" ON "health_score_history"("tenant_id", "date");
