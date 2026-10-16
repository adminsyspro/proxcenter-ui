// src/lib/firewall/logs.ts
// Builds the firewall log a guest, a security group, a node or the cluster
// shows (ui#1114) from PVE's two log endpoints:
// - the guest log keeps only the lines of its own VMID, so it has the guest's
//   rules and policy but never a security group hit (logged with VMID 0);
// - the node log has every line, group hits included, and needs Sys.Syslog
//   where the guest log needs VM.Console.
// A guest therefore reads its own log plus its node's group lines on its
// interfaces, and a group reads every node's log. A node is its whole log; the
// cluster is every node's host chain lines, where the datacenter and host rules
// log (VMID 0, PVEFW-HOST-IN/OUT). A node that cannot be read becomes a
// warning, never a failure of the whole view.

import { errorMessage } from './loadError'
import { inferGroupAction, parseFirewallLogLine, ruleCandidates } from './logParse'

import type { AddressBook, LogAction, LogDirection, ParsedLogLine as ParsedLine } from './logParse'
import type { FirewallLogEntry, FirewallRule, SecurityGroup } from '@/lib/api/firewall'

export type FirewallLogScope =
  | { kind: 'vm'; node: string; vmType: 'qemu' | 'lxc'; vmid: number }
  | { kind: 'group'; group: string }
  | { kind: 'node'; node: string }
  | { kind: 'cluster' }

export interface FirewallLogRow {
  id: string
  node: string
  /** Epoch milliseconds. */
  ts: number
  level: number
  chain: string
  direction?: LogDirection
  action?: LogAction
  /** Deduced from the group's rules: the iptables backend logged no action. */
  actionInferred: boolean
  policy: boolean
  /** What decided: a security group rule, the guest's own rules, or a host chain. */
  origin: 'group' | 'guest' | 'host'
  group?: string
  vmid?: number
  src?: string
  dst?: string
  proto?: string
  sport?: number
  dport?: number
  icmpType?: number
  /**
   * Positions of the rules that may have written the line, in rule order: the
   * group's rules for a group hit, the guest's own rules for a guest rule hit.
   * PVE never logs the rule, so more than one means the log cannot tell.
   */
  ruleCandidates?: number[]
  raw: string
}

export interface FirewallLogWarning {
  node: string
  kind: 'permission' | 'offline' | 'error'
  message: string
}

export interface FirewallLogResult {
  rows: FirewallLogRow[]
  warnings: FirewallLogWarning[]
  /** More lines than MAX_LOG_ROWS matched, or a log was longer than MAX_SCAN_LINES: the oldest were dropped. */
  truncated: boolean
}

export const MAX_LOG_ROWS = 5000
/**
 * Lines parsed per log read, the newest kept: a week of a busy node's log is
 * read in full by PVE, and matching every line against the rules would cost
 * far more than the MAX_LOG_ROWS the view shows.
 */
export const MAX_SCAN_LINES = 20000

export interface LogWindowSec {
  since: number
  until?: number
}

/** Where the lines come from; the route wires these to the orchestrator or PVE. */
export interface FirewallLogSources {
  vmLog: (node: string, vmType: string, vmid: number, window: LogWindowSec) => Promise<FirewallLogEntry[]>
  nodeLog: (node: string, window: LogWindowSec) => Promise<FirewallLogEntry[]>
  nodes: () => Promise<{ node: string; status?: string }[]>
  groups: () => Promise<SecurityGroup[]>
  /** The guest's own rules, to tell which one wrote a guest rule line. */
  vmRules: (node: string, vmType: string, vmid: number) => Promise<FirewallRule[]>
  addressBook: () => Promise<AddressBook>
}

const PERMISSION_RE = /\b403\b|permission check failed/i

function toWarning(node: string, err: unknown): FirewallLogWarning {
  const message = errorMessage(err)

  return { node, kind: PERMISSION_RE.test(message) ? 'permission' : 'error', message }
}

const sameGroup = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

function originOf(p: ParsedLine): FirewallLogRow['origin'] {
  if (p.group) return 'group'

  return p.vmid > 0 || p.guestVmid !== undefined ? 'guest' : 'host'
}

/** Runs `load` once, on first use, and shares the promise. */
function lazy<T>(load: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null

  return () => (p ??= load())
}

export async function collectFirewallLog(scope: FirewallLogScope, window: LogWindowSec, sources: FirewallLogSources): Promise<FirewallLogResult> {
  const warnings: FirewallLogWarning[] = []
  const rows: FirewallLogRow[] = []
  // Read order: within one second, a later line of the same file is newer.
  const seq = new Map<FirewallLogRow, number>()
  const groups = lazy(sources.groups)
  const book = lazy(sources.addressBook)
  const guestRules = scope.kind === 'vm' ? lazy(() => sources.vmRules(scope.node, scope.vmType, scope.vmid)) : null

  let scanCapped = false

  const push = async (node: string, all: FirewallLogEntry[], source: string, keep: (p: ParsedLine) => boolean) => {
    // PVE returns the window oldest first: the newest lines are the last ones.
    const entries = all.length > MAX_SCAN_LINES ? all.slice(-MAX_SCAN_LINES) : all

    scanCapped ||= entries !== all

    for (const entry of entries) {
      const p = parseFirewallLogLine(entry.t)

      if (!p || !keep(p)) continue

      let action = p.action
      let actionInferred = false
      let candidates: number[] | undefined

      // Without the rules a line simply stays without action or rule.
      try {
        if (p.group) {
          const group = (await groups()).find(g => sameGroup(g.group, p.group!))
          const rules = group?.rules || []

          if (!action && group) {
            action = inferGroupAction(p, rules, await book())
            actionInferred = !!action
          }
          if (group) candidates = ruleCandidates({ ...p, action }, rules, await book())
        } else if (guestRules && p.vmid > 0 && !p.policy && p.action) {
          candidates = ruleCandidates(p, await guestRules(), await book())
        }
      } catch {
        candidates = undefined
      }

      const row: FirewallLogRow = {
        id: `${node}:${source}:${entry.n}`,
        node,
        ts: p.ts,
        level: p.level,
        chain: p.chain,
        direction: p.direction,
        action,
        actionInferred,
        policy: p.policy,
        origin: originOf(p),
        group: p.group,
        vmid: p.vmid > 0 ? p.vmid : p.guestVmid,
        src: p.src,
        dst: p.dst,
        proto: p.proto,
        sport: p.sport,
        dport: p.dport,
        icmpType: p.icmpType,
        ruleCandidates: candidates,
        raw: p.raw,
      }

      seq.set(row, seq.size)
      rows.push(row)
    }
  }

  if (scope.kind === 'vm') {
    const { node, vmType, vmid } = scope

    // The guest log is the view's own data: its failure is the route's failure.
    const [own, nodeLines] = await Promise.all([
      sources.vmLog(node, vmType, vmid, window),
      sources.nodeLog(node, window).catch(err => {
        warnings.push(toWarning(node, err))

        return [] as FirewallLogEntry[]
      }),
    ])

    await push(node, own, 'vm', () => true)
    await push(node, nodeLines, 'node', p => p.vmid === 0 && !!p.group && p.guestVmid === vmid)
  } else if (scope.kind === 'node') {
    // The node's own log is the view's data, as the guest log is a guest's.
    await push(scope.node, await sources.nodeLog(scope.node, window), 'node', () => true)
  } else {
    const keep = scope.kind === 'group'
      ? (p: ParsedLine) => !!p.group && sameGroup(p.group, scope.group)
      : (p: ParsedLine) => p.vmid === 0 && !p.group && p.guestVmid === undefined
    const nodes = await sources.nodes()

    await Promise.all(nodes.map(async ({ node, status }) => {
      if (status && status !== 'online') {
        warnings.push({ node, kind: 'offline', message: status })

        return
      }

      let lines: FirewallLogEntry[]

      try {
        lines = await sources.nodeLog(node, window)
      } catch (err) {
        warnings.push(toWarning(node, err))

        return
      }

      await push(node, lines, 'node', keep)
    }))
  }

  rows.sort((a, b) => b.ts - a.ts || seq.get(b)! - seq.get(a)!)
  warnings.sort((a, b) => a.node.localeCompare(b.node))

  return { rows: rows.slice(0, MAX_LOG_ROWS), warnings, truncated: rows.length > MAX_LOG_ROWS || scanCapped }
}
