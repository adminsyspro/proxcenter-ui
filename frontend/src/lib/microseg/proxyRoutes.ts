// src/lib/microseg/proxyRoutes.ts
//
// The micro-segmentation routes the orchestrator serves under
// /api/v1/microseg/{connectionId}. The Next catch-all relays these and
// nothing else: an unknown path or verb answers 404 here, before the
// orchestrator is called. `write` decides the permission the caller needs
// (node.manage for a write, node.view for a read).
//
// `audit` says who writes the audit row of a call, so that every write leaves
// exactly one: the orchestrator audits the six lifecycle actions itself
// (apply, zone state, zone outbound state, emergency stop, restore, remove, see
// internal/microseg/audit.go of the backend), the relay audits the draft writes
// and the manual check under `auditAction`, and a read (or the plan preview) is
// audited by nobody.
// A lifecycle call that Next refuses before it reaches the orchestrator (RBAC,
// ownership, body size) is audited by the relay under the orchestrator's own
// action name, since the orchestrator never sees it.

import type { AuditAction } from '@/lib/audit'

export type MicrosegAuditBy = 'orchestrator' | 'relay' | 'none'

type RouteBase = {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** Tested against the path segments after the connection id, joined with "/". */
  pattern: RegExp
  write: boolean
}

export type MicrosegRoute =
  | (RouteBase & { audit: 'none' })
  | (RouteBase & { audit: Exclude<MicrosegAuditBy, 'none'>; auditAction: AuditAction })

const read = (pattern: RegExp): MicrosegRoute => ({ method: 'GET', pattern, write: false, audit: 'none' })

export const MICROSEG_ROUTES: MicrosegRoute[] = [
  read(/^policy$/),
  { method: 'PUT', pattern: /^policy$/, write: true, audit: 'relay', auditAction: 'microseg.policy.update' },
  // R66: the draft back to the last applied revision (a draft write, nothing changes on Proxmox).
  { method: 'POST', pattern: /^policy\/discard$/, write: true, audit: 'relay', auditAction: 'microseg.policy.discard' },
  { method: 'POST', pattern: /^zones$/, write: true, audit: 'relay', auditAction: 'microseg.zone.create' },
  { method: 'PUT', pattern: /^zones\/[^/]+$/, write: true, audit: 'relay', auditAction: 'microseg.zone.update' },
  { method: 'DELETE', pattern: /^zones\/[^/]+$/, write: true, audit: 'relay', auditAction: 'microseg.zone.delete' },
  { method: 'POST', pattern: /^zones\/[^/]+\/state$/, write: true, audit: 'orchestrator', auditAction: 'microseg.state' },
  { method: 'POST', pattern: /^zones\/[^/]+\/egress-state$/, write: true, audit: 'orchestrator', auditAction: 'microseg.egress_state' },
  { method: 'POST', pattern: /^flows$/, write: true, audit: 'relay', auditAction: 'microseg.flow.create' },
  { method: 'PUT', pattern: /^flows\/[^/]+$/, write: true, audit: 'relay', auditAction: 'microseg.flow.update' },
  { method: 'DELETE', pattern: /^flows\/[^/]+$/, write: true, audit: 'relay', auditAction: 'microseg.flow.delete' },
  { method: 'POST', pattern: /^members$/, write: true, audit: 'relay', auditAction: 'microseg.members.set' },
  // A dry run: it computes the plan and changes nothing.
  { method: 'POST', pattern: /^plan$/, write: true, audit: 'none' },
  { method: 'POST', pattern: /^apply$/, write: true, audit: 'orchestrator', auditAction: 'microseg.apply' },
  read(/^revisions$/),
  { method: 'POST', pattern: /^revisions\/[^/]+\/restore$/, write: true, audit: 'orchestrator', auditAction: 'microseg.restore' },
  read(/^suggestions$/),
  { method: 'POST', pattern: /^suggestions\/resolve$/, write: true, audit: 'relay', auditAction: 'microseg.suggestions.resolve' },
  read(/^drifts$/),
  read(/^preflight$/),
  { method: 'POST', pattern: /^confirm-writes$/, write: true, audit: 'relay', auditAction: 'microseg.confirm_writes' },
  { method: 'POST', pattern: /^emergency-stop$/, write: true, audit: 'orchestrator', auditAction: 'microseg.emergency_stop' },
  { method: 'POST', pattern: /^remove$/, write: true, audit: 'orchestrator', auditAction: 'microseg.remove' },
  // Queues a manual check: the engine reads, compares and realigns at its next pass, like a scheduled full run.
  { method: 'POST', pattern: /^check$/, write: true, audit: 'relay', auditAction: 'microseg.check' },
  read(/^runs$/),
  read(/^runs\/[^/]+$/),
  read(/^status$/),
  // The engine's in-memory ring of flows seen towards zone guests: no Proxmox call.
  read(/^events$/),
  // The persisted history of those flows per bucket (7 days, the engine's database): no Proxmox call either.
  read(/^traffic$/),
]

// Every segment is a plain identifier or a route word: no dot, no slash, no
// percent sign, so nothing can be re-interpreted on the way to the orchestrator.
const SEGMENT = /^[A-Za-z0-9_-]+$/

export function matchMicrosegRoute(method: string, path: string[]): MicrosegRoute | null {
  if (path.length === 0 || !path.every(segment => SEGMENT.test(segment))) return null

  const joined = path.join('/')

  return MICROSEG_ROUTES.find(route => route.method === method && route.pattern.test(joined)) ?? null
}
