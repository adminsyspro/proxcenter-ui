CREATE UNIQUE INDEX "favorites_tenant_id_user_id_vm_key_key" ON "favorites"("tenant_id", "user_id", "vm_key");

DROP INDEX "favorites_user_id_vm_key_key";
