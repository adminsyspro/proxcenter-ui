import { defineConfig } from "prisma/config"

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
    url: process.env.DATABASE_URL!,
  },
})
