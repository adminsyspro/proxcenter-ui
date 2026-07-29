-- CreateTable
CREATE TABLE "broadcast_messages" (
    "id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "bg_color" TEXT NOT NULL,
    "fg_color" TEXT NOT NULL,
    "dismissible" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "target_kind" TEXT NOT NULL DEFAULT 'all',
    "target_ids" JSONB NOT NULL DEFAULT '[]',
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broadcast_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "broadcast_messages_enabled_starts_at_ends_at_idx" ON "broadcast_messages"("enabled", "starts_at", "ends_at");
