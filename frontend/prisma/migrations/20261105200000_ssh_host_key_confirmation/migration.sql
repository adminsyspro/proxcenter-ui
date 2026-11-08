ALTER TABLE "ssh_host_keys" ALTER COLUMN "key_data" DROP NOT NULL;
ALTER TABLE "ssh_host_keys" ADD COLUMN "pending_key_data" BYTEA;
ALTER TABLE "ssh_host_keys" ADD COLUMN "pending_seen_at" TIMESTAMP(3);
ALTER TABLE "ssh_host_keys" ADD COLUMN "confirmed_at" TIMESTAMP(3);
ALTER TABLE "ssh_host_keys" ADD COLUMN "confirmed_by" TEXT;

DROP INDEX "ssh_host_keys_host_key";
CREATE UNIQUE INDEX "ssh_host_keys_host_key_type_key" ON "ssh_host_keys"("host", "key_type");
CREATE INDEX "ssh_host_keys_host_idx" ON "ssh_host_keys"("host");
