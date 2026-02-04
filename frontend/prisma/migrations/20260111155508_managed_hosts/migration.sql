-- CreateTable
CREATE TABLE "ManagedHost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connectionId" TEXT,
    "node" TEXT NOT NULL,
    "displayName" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ManagedHost_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ManagedHost_connectionId_node_key" ON "ManagedHost"("connectionId", "node");
