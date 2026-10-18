import { assertNodeName } from "@/lib/ssh/validate"

/**
 * The drain settings the browser may send (#248), checked one by one: only
 * these keys reach the orchestrator, with their type and bounds, and the SSH
 * fields are never taken from the request (the route adds them from the
 * connection itself).
 */
export interface DrainConfigInput {
  target_node?: string
  exclude_nodes?: string[]
  max_concurrent_migrations?: number
  migration_timeout?: number
  mem_ceiling_percent?: number
  include_stopped?: boolean
  enter_maintenance?: boolean
  guest_targets?: Record<string, string>
  keep_vmids?: number[]
}

export class DrainConfigError extends Error {}

const intIn = (raw: unknown, min: number, max: number, field: string): number => {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min || n > max) throw new DrainConfigError(`${field} must be an integer between ${min} and ${max}`)
  return n
}

const MAX_GUESTS = 1000

const vmid = (raw: unknown, field: string): number => {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > 999999999) throw new DrainConfigError(`${field} holds an invalid VMID`)
  return n
}

const bool = (raw: unknown, field: string): boolean => {
  if (typeof raw !== "boolean") throw new DrainConfigError(`${field} must be true or false`)
  return raw
}

const nodeName = (raw: unknown, field: string): string => {
  try {
    return assertNodeName(raw)
  } catch {
    throw new DrainConfigError(`${field} is not a valid node name`)
  }
}

export function sanitizeDrainConfig(raw: unknown): DrainConfigInput {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== "object" || Array.isArray(raw)) throw new DrainConfigError("config must be an object")
  const input = raw as Record<string, unknown>
  const config: DrainConfigInput = {}

  if (input.target_node !== undefined && input.target_node !== "") config.target_node = nodeName(input.target_node, "target_node")
  if (input.exclude_nodes !== undefined) {
    if (!Array.isArray(input.exclude_nodes) || input.exclude_nodes.length > 64) throw new DrainConfigError("exclude_nodes must be a list of node names")
    config.exclude_nodes = input.exclude_nodes.map(n => nodeName(n, "exclude_nodes"))
  }
  if (input.max_concurrent_migrations !== undefined) config.max_concurrent_migrations = intIn(input.max_concurrent_migrations, 1, 5, "max_concurrent_migrations")
  if (input.migration_timeout !== undefined) config.migration_timeout = intIn(input.migration_timeout, 60, 86400, "migration_timeout")
  if (input.mem_ceiling_percent !== undefined) config.mem_ceiling_percent = intIn(input.mem_ceiling_percent, 50, 100, "mem_ceiling_percent")
  if (input.include_stopped !== undefined) config.include_stopped = bool(input.include_stopped, "include_stopped")
  if (input.enter_maintenance !== undefined) config.enter_maintenance = bool(input.enter_maintenance, "enter_maintenance")
  // The plan edited guest by guest: a target per VMID, and the guests left
  // on the node (Migrate all VMs only, a node in maintenance is emptied).
  if (input.guest_targets !== undefined) {
    const raw = input.guest_targets
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length > MAX_GUESTS) {
      throw new DrainConfigError("guest_targets must map VMIDs to node names")
    }
    config.guest_targets = Object.fromEntries(Object.entries(raw as Record<string, unknown>)
      .map(([k, v]) => [String(vmid(k, "guest_targets")), nodeName(v, "guest_targets")]))
  }
  if (input.keep_vmids !== undefined) {
    if (!Array.isArray(input.keep_vmids) || input.keep_vmids.length > MAX_GUESTS) throw new DrainConfigError("keep_vmids must be a list of VMIDs")
    config.keep_vmids = input.keep_vmids.map(v => vmid(v, "keep_vmids"))
    if (config.keep_vmids.length > 0 && config.enter_maintenance) {
      throw new DrainConfigError("guests cannot be left on a node entering maintenance")
    }
  }

  return config
}
