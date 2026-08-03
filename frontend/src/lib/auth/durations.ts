// Session timeout configuration, read fresh from the environment on every
// call so a changed timeout applies immediately without a restart.
//
// This module must import NOTHING beyond process.env: Task 8's middleware
// needs sessionDurations() and runs in the Edge runtime, which cannot load
// sessions.ts (it imports Prisma). Keeping this file import-free keeps the
// middleware bundle clean.

const DEFAULT_IDLE_SECONDS = 12 * 3600
const DEFAULT_ABSOLUTE_SECONDS = 7 * 86400

export interface SessionDurations {
  idleMs: number
  absoluteMs: number
}

function positiveSeconds(raw: string | undefined, fallback: number): number {
  const n = Number(raw)
  // A malformed or non-positive value must not silently disable a security
  // deadline, so it falls back to the default rather than to "no limit".
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function sessionDurations(): SessionDurations {
  return {
    idleMs: positiveSeconds(process.env.SESSION_IDLE_TIMEOUT, DEFAULT_IDLE_SECONDS) * 1000,
    absoluteMs: positiveSeconds(process.env.SESSION_ABSOLUTE_TIMEOUT, DEFAULT_ABSOLUTE_SECONDS) * 1000,
  }
}
