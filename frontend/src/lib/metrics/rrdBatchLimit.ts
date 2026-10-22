// Paths one POST /api/v1/connections/[id]/rrd/batch request may carry. The
// route refuses a larger body; fetchRrdBatch splits a longer list into
// requests of this size. Kept on its own, free of server imports, so the
// client bundle can read it too.
export const RRD_BATCH_MAX_PATHS = 50
