-- Bytes received from the backup, reported separately from the bytes written
-- into the guest: the agent method stages each file on disk first.
ALTER TABLE "guest_file_restore_jobs" ADD COLUMN "bytes_read" BIGINT NOT NULL DEFAULT 0;
