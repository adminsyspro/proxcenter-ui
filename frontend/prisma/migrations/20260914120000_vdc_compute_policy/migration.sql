ALTER TABLE "vdcs" ADD COLUMN "cpu_model_mode" TEXT NOT NULL DEFAULT 'unrestricted';
ALTER TABLE "vdcs" ADD COLUMN "cpu_allowed_models" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "vdcs" ADD COLUMN "cpu_default_model" TEXT;
ALTER TABLE "vdcs" ADD COLUMN "cpu_advanced_settings" BOOLEAN NOT NULL DEFAULT true;
