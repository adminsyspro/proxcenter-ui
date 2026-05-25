-- AlterTable: add TOTP columns to users
ALTER TABLE "users" ADD COLUMN "totp_secret_enc" TEXT;
ALTER TABLE "users" ADD COLUMN "totp_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "totp_enrolled_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "totp_last_used_step" BIGINT;

-- AlterTable: add require_2fa_for_super_admin to security_policies
ALTER TABLE "security_policies" ADD COLUMN "require_2fa_for_super_admin" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: user_totp_recovery_codes
CREATE TABLE "user_totp_recovery_codes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "consumed_ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_totp_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_totp_recovery_codes_user_id_consumed_at_idx" ON "user_totp_recovery_codes"("user_id", "consumed_at");

-- AddForeignKey
ALTER TABLE "user_totp_recovery_codes" ADD CONSTRAINT "user_totp_recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
