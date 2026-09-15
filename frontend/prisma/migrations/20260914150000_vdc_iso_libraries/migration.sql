CREATE TABLE "vdc_iso_libraries" (
    "id" TEXT NOT NULL,
    "vdc_id" TEXT NOT NULL,
    "storage_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vdc_iso_libraries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vdc_iso_libraries_vdc_id_storage_id_key" ON "vdc_iso_libraries"("vdc_id", "storage_id");

CREATE INDEX "vdc_iso_libraries_vdc_id_idx" ON "vdc_iso_libraries"("vdc_id");

ALTER TABLE "vdc_iso_libraries" ADD CONSTRAINT "vdc_iso_libraries_vdc_id_fkey" FOREIGN KEY ("vdc_id") REFERENCES "vdcs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
