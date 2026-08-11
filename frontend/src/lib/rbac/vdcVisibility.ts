// Maps a user's RBAC grants to the vDCs their switcher/landing should list
// (design §3.8a). This is a VISIBILITY filter only — it extends no right
// (every action stays gated by hasPermission) and fails open: null grants
// or any grant we cannot map to a single vDC (global, inherit, tag, or an
// unknown future scope type) returns the full list, i.e. today's behavior.
// Mappings rely on the P1 DB invariant unique(tenant_id, connection_id):
// a connection identifies at most one vDC of the tenant.

const MAPPABLE_SCOPE_TYPES = new Set(['connection', 'node', 'vm', 'pool'])

export type VdcVisibilityGrant = { scope_type: string; scope_target: string | null }

export function filterVisibleVdcs<
  T extends { connectionId: string; pvePoolName: string; nodes: string[] },
>(vdcs: T[], grants: VdcVisibilityGrant[] | null): T[] {
  if (grants === null) return vdcs
  if (grants.some((g) => !MAPPABLE_SCOPE_TYPES.has(g.scope_type))) return vdcs

  const visible = new Set<T>()
  for (const grant of grants) {
    if (!grant.scope_target) continue
    const parts = grant.scope_target.split(':')
    for (const vdc of vdcs) {
      switch (grant.scope_type) {
        case 'connection':
          if (vdc.connectionId === grant.scope_target) visible.add(vdc)
          break
        case 'pool':
          if (vdc.pvePoolName === grant.scope_target) visible.add(vdc)
          break
        case 'node':
          // target: "<connId>:<nodeName>"
          if (vdc.connectionId === parts[0] && vdc.nodes.includes(parts[1])) visible.add(vdc)
          break
        case 'vm':
          // target: "<connId>:<node>:<type>:<vmid>" — the vDC of that connection
          if (vdc.connectionId === parts[0]) visible.add(vdc)
          break
      }
    }
  }

  return vdcs.filter((v) => visible.has(v))
}
