-- Other clusters holding a copy of a volume-mode image, declared by its owner.
-- Existing images keep their single source cluster.
ALTER TABLE "custom_images"
  ADD COLUMN "extra_locations" JSONB NOT NULL DEFAULT '[]';
