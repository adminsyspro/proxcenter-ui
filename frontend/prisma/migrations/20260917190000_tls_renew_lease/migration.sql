-- Single-row lease guarding the ACME order, one holder at a time across HA
-- replicas. It replaces pg_try_advisory_lock, which Prisma's connection pool
-- cannot use safely: the acquire and the release land on different backend
-- sessions and pg_advisory_unlock returns false silently when the caller does
-- not hold the lock, leaking it for the life of that connection.
--
-- CreateTable
CREATE TABLE "tls_renew_leases" (
    "id" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "held_until" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tls_renew_leases_pkey" PRIMARY KEY ("id")
);
