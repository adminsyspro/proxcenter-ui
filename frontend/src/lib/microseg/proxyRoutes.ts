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
// internal/microseg/audit.go of the backend) and the association and
// dissociation of a cluster (with the cluster added or removed), the relay
// audits the draft writes and the manual check under `auditAction`, and a read
// (or the plan preview) is audited by nobody.
// A lifecycle call that Next refuses before it reaches the orchestrator (RBAC,
// ownership, body size) is audited by the relay under the orchestrator's own
// action name, since the orchestrator never sees it.
//
// `scope` says on which connections the caller needs that permission. A
// `cluster` route reads or writes the URL's cluster alone. A `policy` route
// reads or writes the policy shared by every cluster linked to the URL's one
// (or another cluster's data: the peers named in the drifts, or their
// firewall: a removal), so the relay checks the caller on every linked
// connection and tells the orchestrator which ones it checked.

import type { AuditAction } from '@/lib/audit'

export type MicrosegAuditBy = 'orchestrator' | 'relay' | 'none'

type RouteBase = {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** Tested against the path segments after the connection id, joined with "/". */
  pattern: RegExp
  write: boolean
  scope: 'policy' | 'cluster'
  /** The association of a cluster: the relay also checks the connection its body names, and forwards a body it rebuilt. */
  associate?: true
  /** GET clusters: answered from the clusters read the relay makes for the rights, not asked a second time. */
  clustersRead?: true
  /**
   * GET runs/{id}: the orchestrator serves any run of the policy through any of its clusters, so the relay hands back
   * only a run of the URL's cluster (or of older data, with no cluster), the generic not found otherwise.
   */
  urlClusterRun?: true
}

export type MicrosegRoute =
  | (RouteBase & { audit: 'none' })
  | (RouteBase & { audit: Exclude<MicrosegAuditBy, 'none'>; auditAction: AuditAction })

const read = (pattern: RegExp, scope: RouteBase['scope'], extra: Pick<RouteBase, 'clustersRead' | 'urlClusterRun'> = {}): MicrosegRoute =>
  ({ method: 'GET', pattern, write: false, audit: 'none', scope, ...extra })

export const MICROSEG_ROUTES: MicrosegRoute[] = [
  read(/^policy$/, 'policy'),
  { method: 'PUT', pattern: /^policy$/, write: true, audit: 'relay', auditAction: 'microseg.policy.update', scope: 'policy' },
  // R66: the draft back to the last applied revision (a draft write, nothing changes on Proxmox).
  { method: 'POST', pattern: /^policy\/discard$/, write: true, audit: 'relay', auditAction: 'microseg.policy.discard', scope: 'policy' },
  { method: 'POST', pattern: /^zones$/, write: true, audit: 'relay', auditAction: 'microseg.zone.create', scope: 'policy' },
  { method: 'PUT', pattern: /^zones\/[^/]+$/, write: true, audit: 'relay', auditAction: 'microseg.zone.update', scope: 'policy' },
  { method: 'DELETE', pattern: /^zones\/[^/]+$/, write: true, audit: 'relay', auditAction: 'microseg.zone.delete', scope: 'policy' },
  { method: 'POST', pattern: /^zones\/[^/]+\/state$/, write: true, audit: 'orchestrator', auditAction: 'microseg.state', scope: 'policy' },
  { method: 'POST', pattern: /^zones\/[^/]+\/egress-state$/, write: true, audit: 'orchestrator', auditAction: 'microseg.egress_state', scope: 'policy' },
  { method: 'POST', pattern: /^flows$/, write: true, audit: 'relay', auditAction: 'microseg.flow.create', scope: 'policy' },
  { method: 'PUT', pattern: /^flows\/[^/]+$/, write: true, audit: 'relay', auditAction: 'microseg.flow.update', scope: 'policy' },
  { method: 'DELETE', pattern: /^flows\/[^/]+$/, write: true, audit: 'relay', auditAction: 'microseg.flow.delete', scope: 'policy' },
  // The exceptions of a zone are draft writes like the flows; they are read with GET /policy.
  { method: 'POST', pattern: /^exceptions$/, write: true, audit: 'relay', auditAction: 'microseg.exception.create', scope: 'cluster' },
  { method: 'PUT', pattern: /^exceptions\/[^/]+$/, write: true, audit: 'relay', auditAction: 'microseg.exception.update', scope: 'cluster' },
  { method: 'DELETE', pattern: /^exceptions\/[^/]+$/, write: true, audit: 'relay', auditAction: 'microseg.exception.delete', scope: 'cluster' },
  { method: 'POST', pattern: /^members$/, write: true, audit: 'relay', auditAction: 'microseg.members.set', scope: 'cluster' },
  // A dry run: it computes the plan and changes nothing.
  { method: 'POST', pattern: /^plan$/, write: true, audit: 'none', scope: 'policy' },
  { method: 'POST', pattern: /^apply$/, write: true, audit: 'orchestrator', auditAction: 'microseg.apply', scope: 'policy' },
  read(/^revisions$/, 'policy'),
  { method: 'POST', pattern: /^revisions\/[^/]+\/restore$/, write: true, audit: 'orchestrator', auditAction: 'microseg.restore', scope: 'policy' },
  read(/^suggestions$/, 'policy'),
  { method: 'POST', pattern: /^suggestions\/resolve$/, write: true, audit: 'relay', auditAction: 'microseg.suggestions.resolve', scope: 'policy' },
  // Names the peer clusters (an unreadable peer, its name and ID).
  read(/^drifts$/, 'policy'),
  read(/^preflight$/, 'cluster'),
  { method: 'POST', pattern: /^confirm-writes$/, write: true, audit: 'relay', auditAction: 'microseg.confirm_writes', scope: 'cluster' },
  { method: 'POST', pattern: /^emergency-stop$/, write: true, audit: 'orchestrator', auditAction: 'microseg.emergency_stop', scope: 'policy' },
  // On a shared policy the cluster leaves the policy and the other clusters drop its addresses from their ipsets: a
  // write on every cluster, like a dissociation. The clusters read it needs is not licence-gated, so an unlicensed or
  // single-cluster removal still goes through.
  { method: 'POST', pattern: /^remove$/, write: true, audit: 'orchestrator', auditAction: 'microseg.remove', scope: 'policy' },
  // Turns the cluster firewall of the URL's cluster back on: a write on that cluster alone.
  { method: 'POST', pattern: /^cluster-firewall\/enable$/, write: true, audit: 'orchestrator', auditAction: 'microseg.cluster_firewall.enable', scope: 'cluster' },
  // Queues a manual check: the engine reads, compares and realigns at its next pass, like a scheduled full run.
  { method: 'POST', pattern: /^check$/, write: true, audit: 'relay', auditAction: 'microseg.check', scope: 'cluster' },
  read(/^runs$/, 'cluster'),
  // Polled every 2 s per cluster during a run: the rights of the URL's cluster alone, and the relay hands back only a
  // run of that cluster (the orchestrator serves any run of the policy).
  read(/^runs\/[^/]+$/, 'cluster', { urlClusterRun: true }),
  read(/^status$/, 'cluster'),
  // The engine's in-memory ring of flows seen towards zone guests: no Proxmox call.
  read(/^events$/, 'cluster'),
  // The persisted history of those flows per bucket (7 days, the engine's database): no Proxmox call either.
  read(/^traffic$/, 'cluster'),
  // The sFlow volume between the zones per bucket (7 days, the orchestrator's database): no Proxmox call.
  read(/^volume$/, 'cluster'),
  // The clusters sharing the policy. Associating one also needs the caller's
  // rights on the connection the body brings in (checked by the relay).
  read(/^clusters$/, 'policy', { clustersRead: true }),
  { method: 'POST', pattern: /^clusters$/, write: true, audit: 'orchestrator', auditAction: 'microseg.cluster.associate', scope: 'policy', associate: true },
  { method: 'DELETE', pattern: /^clusters\/[^/]+$/, write: true, audit: 'orchestrator', auditAction: 'microseg.cluster.dissociate', scope: 'policy' },
]

// Every segment is a plain identifier or a route word: no dot, no slash, no
// percent sign, so nothing can be re-interpreted on the way to the orchestrator.
const SEGMENT = /^[A-Za-z0-9_-]+$/

export function matchMicrosegRoute(method: string, path: string[]): MicrosegRoute | null {
  if (path.length === 0 || !path.every(segment => SEGMENT.test(segment))) return null

  const joined = path.join('/')

  return MICROSEG_ROUTES.find(route => route.method === method && route.pattern.test(joined)) ?? null
}
