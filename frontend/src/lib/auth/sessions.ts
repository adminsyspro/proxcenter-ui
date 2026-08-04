// Server-side session store over the `sessions` table.
//
// The cookie remains a NextAuth JWT carrying this row's id as `sid`. What the
// row adds is the ability to say "no" after the fact: revocation, an idle
// timeout, and an absolute cap that activity cannot renew.
//
// Deadlines are derived from the CURRENT configuration at evaluation time, not
// stored on the row, so raising or lowering a timeout applies to sessions that
// are already open.
import { nanoid } from "nanoid"

import { prisma } from "@/lib/db/prisma"

import { isPastAbsoluteCap, sessionDurations, type SessionDurations } from "./durations"

/** A touch is at most one write per session per minute: this callback runs on every guarded request. */
export const TOUCH_THROTTLE_MS = 60_000

const USER_AGENT_MAX = 255

export interface SessionRow {
  id: string
  userId: string
  createdAt: Date
  lastSeenAt: Date
  revokedAt: Date | null
  ipAddress: string | null
  userAgent: string | null
}

export type DeadReason = "missing" | "revoked" | "idle" | "absolute"
export type SessionVerdict = { alive: true } | { alive: false; reason: DeadReason }

export function evaluateSession(
  row: SessionRow | null | undefined,
  now: Date = new Date(),
  durations: SessionDurations = sessionDurations(),
): SessionVerdict {
  if (!row) return { alive: false, reason: "missing" }
  if (row.revokedAt) return { alive: false, reason: "revoked" }
  if (isPastAbsoluteCap(row.createdAt.getTime(), now.getTime(), durations)) {
    return { alive: false, reason: "absolute" }
  }
  if (now.getTime() - row.lastSeenAt.getTime() > durations.idleMs) {
    return { alive: false, reason: "idle" }
  }
  return { alive: true }
}

/** Prisma `where` fragment matching live rows. Mirrors evaluateSession. */
export function aliveWhere(
  now: Date = new Date(),
  durations: SessionDurations = sessionDurations(),
) {
  return {
    revokedAt: null,
    // gte, not gt: evaluateSession treats a row exactly at the cutoff as
    // still alive (it only kills a row once elapsed time is STRICTLY
    // greater than the duration), and isDeadPredicate below only kills a
    // row once elapsed time is strictly less than the cutoff (lt). gte is
    // the exact complement of that lt, so a row sits in exactly one of
    // aliveWhere/isDeadPredicate at every instant, never neither.
    lastSeenAt: { gte: new Date(now.getTime() - durations.idleMs) },
    createdAt: { gte: new Date(now.getTime() - durations.absoluteMs) },
  }
}

/** Prisma `where` fragment matching dead rows, for the purge. */
export function isDeadPredicate(
  now: Date = new Date(),
  durations: SessionDurations = sessionDurations(),
) {
  return {
    OR: [
      { revokedAt: { not: null } },
      { lastSeenAt: { lt: new Date(now.getTime() - durations.idleMs) } },
      { createdAt: { lt: new Date(now.getTime() - durations.absoluteMs) } },
    ],
  }
}

export async function createSession(args: {
  userId: string
  ipAddress?: string | null
  userAgent?: string | null
}): Promise<string> {
  const id = nanoid(32)
  const now = new Date()

  await prisma.session.create({
    data: {
      id,
      userId: args.userId,
      createdAt: now,
      lastSeenAt: now,
      ipAddress: args.ipAddress ?? null,
      userAgent: args.userAgent ? args.userAgent.slice(0, USER_AGENT_MAX) : null,
    },
  })

  return id
}

/**
 * Refresh lastSeenAt, at most once per TOUCH_THROTTLE_MS per session.
 *
 * `known` lets the caller pass the row it has already read (the jwt callback
 * always has it) so the throttle costs no extra query. The update is scoped to
 * a live row so a touch racing a revoke cannot resurrect the session.
 */
export async function touchSession(
  sid: string,
  now: Date = new Date(),
  known?: SessionRow | null,
): Promise<void> {
  if (known && now.getTime() - known.lastSeenAt.getTime() <= TOUCH_THROTTLE_MS) return

  await prisma.session.updateMany({
    where: { id: sid, revokedAt: null },
    data: { lastSeenAt: now },
  })
}

export async function listSessions(userId: string): Promise<SessionRow[]> {
  return prisma.session.findMany({
    where: { userId, ...aliveWhere() },
    orderBy: { lastSeenAt: "desc" },
  }) as unknown as Promise<SessionRow[]>
}

export async function countActiveSessions(userId: string): Promise<number> {
  return prisma.session.count({ where: { userId, ...aliveWhere() } })
}

/** Scoped to the owner: another user's sid must be indistinguishable from a missing one. */
export async function revokeSession(sid: string, userId: string): Promise<boolean> {
  const res = await prisma.session.updateMany({
    where: { id: sid, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  return res.count > 0
}

export async function revokeAllSessions(
  userId: string,
  exceptSid?: string | null,
): Promise<number> {
  const res = await prisma.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(exceptSid ? { id: { not: exceptSid } } : {}),
    },
    data: { revokedAt: new Date() },
  })
  return res.count
}

/**
 * Installation-wide revoke: every live session of every user, the caller's
 * own included. Total by design — this backs the admin "everyone out"
 * button, and the UI's next act is to send the caller to /login through the
 * same deterministic redirect as every other self-revocation flow.
 */
export async function revokeEverySession(): Promise<number> {
  const res = await prisma.session.updateMany({
    where: { revokedAt: null },
    data: { revokedAt: new Date() },
  })
  return res.count
}

export async function purgeDeadSessions(now: Date = new Date()): Promise<number> {
  const res = await prisma.session.deleteMany({ where: isDeadPredicate(now) })
  return res.count
}
