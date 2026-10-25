-- CreateTable
CREATE TABLE "tls_certificates" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "common_name" TEXT NOT NULL,
    "san_names" TEXT[],
    "cert_pem" TEXT NOT NULL,
    "chain_pem" TEXT,
    "key_encrypted" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "not_before" TIMESTAMP(3) NOT NULL,
    "not_after" TIMESTAMP(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tls_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tls_acme_accounts" (
    "id" TEXT NOT NULL,
    "directory_url" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "account_url" TEXT,
    "key_encrypted" TEXT NOT NULL,
    "terms_agreed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tls_acme_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tls_acme_challenges" (
    "token" TEXT NOT NULL,
    "key_authorization" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tls_acme_challenges_pkey" PRIMARY KEY ("token")
);

-- CreateIndex
CREATE INDEX "tls_certificates_is_active_idx" ON "tls_certificates"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "tls_acme_accounts_directory_url_key" ON "tls_acme_accounts"("directory_url");

-- CreateIndex
CREATE INDEX "tls_acme_challenges_expires_at_idx" ON "tls_acme_challenges"("expires_at");

