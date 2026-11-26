CREATE TABLE "compliance_risk_acceptances" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "connection_id" TEXT NOT NULL,
    "check_id" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "accepted_by" TEXT NOT NULL,
    "accepted_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "compliance_risk_acceptances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "compliance_risk_acceptances_tenant_id_connection_id_check_id_key" ON "compliance_risk_acceptances"("tenant_id", "connection_id", "check_id");
CREATE INDEX "compliance_risk_acceptances_tenant_id_idx" ON "compliance_risk_acceptances"("tenant_id");

ALTER TABLE "compliance_risk_acceptances" ADD CONSTRAINT "compliance_risk_acceptances_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
