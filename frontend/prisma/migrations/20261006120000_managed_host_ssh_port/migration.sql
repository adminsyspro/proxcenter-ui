ALTER TABLE "ManagedHost" ADD COLUMN "sshPort" INTEGER;

ALTER TABLE "ManagedHost" ADD CONSTRAINT "ManagedHost_sshPort_range" CHECK ("sshPort" IS NULL OR ("sshPort" >= 1 AND "sshPort" <= 65535));
