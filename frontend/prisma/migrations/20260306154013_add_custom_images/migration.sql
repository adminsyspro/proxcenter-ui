-- AlterTable
ALTER TABLE "ManagedHost" ADD COLUMN "description" TEXT;
ALTER TABLE "ManagedHost" ADD COLUMN "ip" TEXT;
ALTER TABLE "ManagedHost" ADD COLUMN "tags" TEXT;

-- CreateTable
CREATE TABLE "DashboardLayout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL DEFAULT 'custom',
    "widgets" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fingerprint" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_type" TEXT NOT NULL DEFAULT 'pve',
    "entity_type" TEXT,
    "entity_id" TEXT,
    "entity_name" TEXT,
    "metric" TEXT,
    "current_value" REAL,
    "threshold" REAL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" DATETIME,
    "acknowledged_by" TEXT,
    "resolved_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "custom_images" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vendor" TEXT NOT NULL DEFAULT 'custom',
    "version" TEXT NOT NULL DEFAULT '',
    "arch" TEXT NOT NULL DEFAULT 'amd64',
    "format" TEXT NOT NULL DEFAULT 'qcow2',
    "source_type" TEXT NOT NULL DEFAULT 'url',
    "download_url" TEXT,
    "checksum_url" TEXT,
    "volume_id" TEXT,
    "default_disk_size" TEXT NOT NULL DEFAULT '20G',
    "min_memory" INTEGER NOT NULL DEFAULT 512,
    "recommended_memory" INTEGER NOT NULL DEFAULT 2048,
    "min_cores" INTEGER NOT NULL DEFAULT 1,
    "recommended_cores" INTEGER NOT NULL DEFAULT 2,
    "ostype" TEXT NOT NULL DEFAULT 'l26',
    "tags" TEXT,
    "created_by" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "blueprints" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "image_slug" TEXT NOT NULL,
    "hardware" TEXT NOT NULL,
    "cloud_init" TEXT,
    "tags" TEXT,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "deployments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "blueprint_id" TEXT,
    "blueprint_name" TEXT,
    "connection_id" TEXT NOT NULL,
    "node" TEXT NOT NULL,
    "vmid" INTEGER NOT NULL,
    "vm_name" TEXT,
    "image_slug" TEXT,
    "config" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "current_step" TEXT,
    "error" TEXT,
    "task_upid" TEXT,
    "started_at" DATETIME,
    "completed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Connection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'pve',
    "baseUrl" TEXT NOT NULL,
    "uiUrl" TEXT,
    "insecureTLS" BOOLEAN NOT NULL DEFAULT false,
    "hasCeph" BOOLEAN NOT NULL DEFAULT false,
    "latitude" REAL,
    "longitude" REAL,
    "locationLabel" TEXT,
    "apiTokenEnc" TEXT NOT NULL,
    "sshEnabled" BOOLEAN NOT NULL DEFAULT false,
    "sshPort" INTEGER NOT NULL DEFAULT 22,
    "sshUser" TEXT NOT NULL DEFAULT 'root',
    "sshAuthMethod" TEXT,
    "sshKeyEnc" TEXT,
    "sshPassEnc" TEXT,
    "sshUseSudo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Connection" ("apiTokenEnc", "baseUrl", "createdAt", "id", "insecureTLS", "name", "sshUseSudo", "uiUrl", "updatedAt") SELECT "apiTokenEnc", "baseUrl", "createdAt", "id", "insecureTLS", "name", "sshUseSudo", "uiUrl", "updatedAt" FROM "Connection";
DROP TABLE "Connection";
ALTER TABLE "new_Connection" RENAME TO "Connection";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "DashboardLayout_userId_name_key" ON "DashboardLayout"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "alerts_fingerprint_key" ON "alerts"("fingerprint");

-- CreateIndex
CREATE INDEX "alerts_status_idx" ON "alerts"("status");

-- CreateIndex
CREATE INDEX "alerts_severity_idx" ON "alerts"("severity");

-- CreateIndex
CREATE INDEX "alerts_source_idx" ON "alerts"("source");

-- CreateIndex
CREATE INDEX "alerts_last_seen_at_idx" ON "alerts"("last_seen_at");

-- CreateIndex
CREATE INDEX "alerts_status_severity_last_seen_at_idx" ON "alerts"("status", "severity", "last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "custom_images_slug_key" ON "custom_images"("slug");

-- CreateIndex
CREATE INDEX "deployments_status_idx" ON "deployments"("status");

-- CreateIndex
CREATE INDEX "deployments_connection_id_idx" ON "deployments"("connection_id");
