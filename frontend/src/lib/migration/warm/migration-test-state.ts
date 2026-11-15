/**
 * Test of a waiting warm migration: what the operator asks for and what the
 * engine reports, as stored on the job row (`testRequest`, `testState`).
 *
 * Pure on purpose: the routes, the engine and the dialogs all read the same
 * rules, and the dialogs run in the browser.
 */

/** What the operator asks for when starting a test. */
export interface MigrationTestRequest {
  /** File-based PVE storage of the target node that holds the overlays. */
  storage: string
  /** Bridge of the test VM's NICs; null = no network at all. */
  bridge: string | null
  /** VLAN tag on that bridge, only with a bridge. */
  vlanTag: number | null
  /** The test stops by itself after this many seconds. */
  maxSec: number
}

export type MigrationTestPhase = "requested" | "preparing" | "running" | "stopping" | "ended" | "failed"

/**
 * Step of the preparation, always three: the node checks, then the guest
 * conversion (or the bare overlay creation when the guest is not converted),
 * then the boot of the test VM.
 */
export type MigrationTestStep = "checks" | "conversion" | "overlay" | "boot"

/** Position of a preparation step, out of three. */
export const MIGRATION_TEST_STEP_INDEX: Record<MigrationTestStep, number> = { checks: 1, conversion: 2, overlay: 2, boot: 3 }

/** What the engine reports about the test, for the dialogs and the cleanup after a restart. */
export interface MigrationTestState {
  phase: MigrationTestPhase
  testVmid?: number
  storage?: string
  /** Step of the preparation running now. */
  step?: MigrationTestStep
  /** When the engine took the request and started the preparation. */
  preparingSince?: string
  /** Overlay paths on the node. */
  overlays?: string[]
  startedAt?: string
  endsAt?: string
  /** Bytes the overlays hold on their storage. */
  overlayBytes?: number
  /** Why the test did not start, or why it ended. */
  reason?: string
  endedAt?: string
}

export const MIGRATION_TEST_MAX_SEC_CHOICES = [3600, 7200, 14400, 28800, 86400] as const
export const MIGRATION_TEST_MAX_SEC_DEFAULT = 14400

const PHASES: readonly MigrationTestPhase[] = ["requested", "preparing", "running", "stopping", "ended", "failed"]
const ACTIVE_PHASES: ReadonlySet<MigrationTestPhase> = new Set(["requested", "preparing", "running", "stopping"])

/** A PVE storage id ([a-zA-Z][a-zA-Z0-9\-_.]*). They reach shell commands on the node. */
const STORAGE_ID_RE = /^[A-Za-z][\w.-]{0,63}$/
/** A Linux interface name. */
const BRIDGE_RE = /^[A-Za-z][\w.-]{0,14}$/

type Parsed = { ok: true; request: MigrationTestRequest } | { ok: false; error: string }

/** Validate a test request from a route body. */
export function parseTestRequest(v: unknown): Parsed {
  const o = v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}
  const storage = typeof o.storage === "string" ? o.storage.trim() : ""
  if (!storage) return { ok: false, error: "storage is required" }
  if (!STORAGE_ID_RE.test(storage)) return { ok: false, error: "storage is not a valid storage id" }
  const bridge = typeof o.bridge === "string" && o.bridge.trim() ? o.bridge.trim() : null
  if (bridge !== null && !BRIDGE_RE.test(bridge)) return { ok: false, error: "bridge is not a valid bridge name" }
  const vlanTag = o.vlanTag === undefined || o.vlanTag === null || o.vlanTag === "" ? null : Number(o.vlanTag)
  if (vlanTag !== null) {
    if (!Number.isInteger(vlanTag) || vlanTag < 1 || vlanTag > 4094) return { ok: false, error: "vlanTag must be between 1 and 4094" }
    if (bridge === null) return { ok: false, error: "vlanTag needs a bridge" }
  }
  const maxSec = Number(o.maxSec)
  if (!(MIGRATION_TEST_MAX_SEC_CHOICES as readonly number[]).includes(maxSec)) {
    return { ok: false, error: `maxSec must be one of ${MIGRATION_TEST_MAX_SEC_CHOICES.join(", ")}` }
  }
  return { ok: true, request: { storage, bridge, vlanTag, maxSec } }
}

/** The test state stored on a row, or null when there is none or it is unreadable. */
export function readTestState(v: unknown): MigrationTestState | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null
  const phase = (v as { phase?: unknown }).phase
  return typeof phase === "string" && (PHASES as readonly string[]).includes(phase) ? v as MigrationTestState : null
}

/** A test was asked for and has not ended yet. */
export function isTestActive(job: { testRequest?: unknown; testState?: unknown }): boolean {
  if (job.testRequest) return true
  const state = readTestState(job.testState)
  return !!state && ACTIVE_PHASES.has(state.phase)
}

interface TestableJob {
  status: string
  cutoverRequestedAt?: unknown
  config?: { cutoverMode?: string | null; migrationType?: string | null } | null
  testRequest?: unknown
  testState?: unknown
}

/**
 * A warm migration that waits for its manual cutover, whose cutover was not
 * asked yet and that runs no test: the only time a test may start.
 */
export function canStartMigrationTest(job: TestableJob): boolean {
  return job.status === "delta_sync" && job.config?.cutoverMode === "manual"
    && job.config?.migrationType !== "cold" && !job.cutoverRequestedAt && !isTestActive(job)
}
