-- AlterTable
ALTER TABLE "users" ADD COLUMN "require_2fa_enrollment" BOOLEAN NOT NULL DEFAULT false;
