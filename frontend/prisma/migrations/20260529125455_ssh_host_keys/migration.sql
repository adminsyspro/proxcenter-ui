
-- CreateTable
CREATE TABLE "ssh_host_keys" (
    "id" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "key_type" TEXT NOT NULL,
    "key_data" BYTEA NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ssh_host_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ssh_host_keys_host_key" ON "ssh_host_keys"("host");

