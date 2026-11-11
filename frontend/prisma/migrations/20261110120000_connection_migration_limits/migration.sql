ALTER TABLE "Connection" ADD COLUMN "migrationMaxParallel" INTEGER;
ALTER TABLE "Connection" ADD COLUMN "migrationMaxPerNode" INTEGER;
ALTER TABLE "Connection" ADD COLUMN "migrationMaxPerSourceHost" INTEGER;
