-- Server instance that owns a migration job, so the startup sweep can fail jobs orphaned by a restart (#608).
ALTER TABLE "migration_jobs" ADD COLUMN "owner_instance_id" TEXT;
