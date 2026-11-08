import { defineConfig } from "prisma/config"

// Relative import on purpose: the runner image loads this file outside the
// Next bundle, where the @/ alias does not exist.
import { migrationDatabaseUrl } from "./src/lib/db/connectionConfig"

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // Idempotent seed used to bootstrap the default tenant, security policy,
    // RBAC permission catalogue and system roles. Safe to re-run; uses upsert
    // semantics so existing rows are reconciled, not duplicated.
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Every CLI command (migrate deploy at container start included) goes
    // through the schema engine, which needs its own TLS form of the URL.
    url: migrationDatabaseUrl(process.env.DATABASE_URL)!,
  },
})
