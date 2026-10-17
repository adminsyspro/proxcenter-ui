/**
 * Node-project setupFile: points this worker's DATABASE_URL at its own
 * schema before the test file (and `@/lib/db/prisma`, which reads it at
 * import time) loads. See ./test-dsn.ts.
 */

import { workerTestDsn } from './test-dsn'

process.env.DATABASE_URL = workerTestDsn()
