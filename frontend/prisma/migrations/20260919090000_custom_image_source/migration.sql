-- The origin of legacy volume images is unknown; do not guess or backfill it
-- from a volume name that may exist on several unrelated clusters/nodes.
ALTER TABLE "custom_images"
  ADD COLUMN "source_connection_id" TEXT,
  ADD COLUMN "source_node" TEXT;
