const { Client } = require('pg');
const { execFileSync } = require('child_process');

const LOCK_ID = 0x50524D49; // ASCII "PRMI" - distinct from leader lock 0x50524F58

function pgDsn(url) {
  const u = new URL(url);
  for (const key of ['connection_limit', 'pool_timeout']) u.searchParams.delete(key);
  return u.toString();
}

if (require.main === module) {
  (async () => {
    const dsn = process.env.DATABASE_URL;
    if (!dsn) {
      console.error('[migrate-with-lock] DATABASE_URL is not set');
      process.exit(1);
    }

    const client = new Client({ connectionString: pgDsn(dsn) });
    await client.connect();
    console.log('[migrate-with-lock] Acquiring migration lock...');
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    console.log('[migrate-with-lock] Lock acquired, running migrations...');
    try {
      execFileSync('node', ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
        stdio: 'inherit',
      });
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]);
      await client.end();
      console.log('[migrate-with-lock] Lock released.');
    }
  })().catch((err) => {
    console.error('[migrate-with-lock] Fatal:', err.message || err);
    process.exit(1);
  });
}

module.exports = { pgDsn, LOCK_ID };
