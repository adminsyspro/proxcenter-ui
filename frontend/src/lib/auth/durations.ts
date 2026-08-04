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

/**
 * The one absolute-cap rule, shared by both sides of the Edge boundary:
 * `sessions.ts:evaluateSession` (Node, DB-backed session rows) and
 * `middleware.ts` (Edge, the JWT's `authAt` claim) each need "has this long
 * elapsed since the start instant exceeded the cap", and had drifted into
 * two separately-written copies of the same comparison. This file already
 * has zero imports and is loaded by both, so the predicate lives here rather
 * than in `sessions.ts` (Prisma-adjacent, Edge-hostile) or `middleware.ts`
 * (would leave `sessions.ts` still duplicating it).
 *
 * Strictly greater-than, matching the existing behaviour in both callers: an
 * elapsed time exactly equal to the cap is NOT past it.
 */
export function isPastAbsoluteCap(
  startMs: number,
  nowMs: number = Date.now(),
  durations: SessionDurations = sessionDurations(),
): boolean {
  return nowMs - startMs > durations.absoluteMs
}
