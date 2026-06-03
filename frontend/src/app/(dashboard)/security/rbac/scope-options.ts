// Build the selectable scope targets for a given scope type from the live
// inventory payload (/api/v1/inventory). Shared by the assignment dialogs and
// the role default-scope editor so the extraction logic lives in one place
// (issue #383). `t` provides the count sublabels; pass a passthrough in tests.

export type ScopeOption = {
  id: string
  label: string
  sublabel?: string
  icon?: string
  status?: string
}

export function buildScopeOptions(inventory: any, scopeType: string, t: any): ScopeOption[] {
  if (!inventory?.clusters) return []

  switch (scopeType) {
    case 'connection':
      return inventory.clusters.map((c: any) => ({
        id: c.id,
        label: c.name,
        sublabel: t('rbacPage.nodeCount', { count: c.nodes?.length || 0 }),
        icon: 'ri-server-line',
        status: c.status,
      }))

    case 'node': {
      const nodes: ScopeOption[] = []
      inventory.clusters.forEach((c: any) => {
        c.nodes?.forEach((n: any) => {
          nodes.push({
            id: `${c.id}:${n.node}`,
            label: n.node,
            sublabel: c.name,
            icon: 'ri-computer-line',
            status: n.status,
          })
        })
      })
      return nodes
    }

    case 'vm': {
      const vms: ScopeOption[] = []
      inventory.clusters.forEach((c: any) => {
        c.nodes?.forEach((n: any) => {
          n.guests?.forEach((g: any) => {
            vms.push({
              id: `${c.id}:${n.node}:${g.type}:${g.vmid}`,
              label: g.name || `${g.type}/${g.vmid}`,
              sublabel: `${String(g.type).toUpperCase()} ${g.vmid} • ${n.node} • ${c.name}`,
              icon: g.type === 'lxc' ? 'ri-box-3-line' : 'ri-instance-line',
              status: g.status,
            })
          })
        })
      })
      return vms
    }

    case 'tag': {
      const tagMap = new Map<string, number>()
      inventory.clusters.forEach((c: any) => {
        c.nodes?.forEach((n: any) => {
          n.guests?.forEach((g: any) => {
            const tags = typeof g.tags === 'string'
              ? g.tags.split(/[;,]/).map((s: string) => s.trim()).filter(Boolean)
              : []
            tags.forEach((tag: string) => tagMap.set(tag, (tagMap.get(tag) || 0) + 1))
          })
        })
      })
      return Array.from(tagMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([tag, count]) => ({
          id: tag,
          label: tag,
          sublabel: t('rbacPage.tagUsedByVms', { count }),
          icon: 'ri-price-tag-3-line',
        }))
    }

    case 'pool': {
      const poolMap = new Map<string, number>()
      inventory.clusters.forEach((c: any) => {
        c.nodes?.forEach((n: any) => {
          n.guests?.forEach((g: any) => {
            if (g.pool) poolMap.set(g.pool, (poolMap.get(g.pool) || 0) + 1)
          })
        })
      })
      return Array.from(poolMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([pool, count]) => ({
          id: pool,
          label: pool,
          sublabel: t('rbacPage.poolContainsVms', { count }),
          icon: 'ri-folder-shared-line',
        }))
    }

    default:
      return []
  }
}

/**
 * Resolve a stored scope target back to its human-readable label (issue #383).
 * connection/node/vm targets are opaque ids, so they are looked up in the live
 * inventory; tag/pool targets are already the display name. Falls back to the
 * raw target when the inventory has not loaded yet or the resource is gone.
 */
export function resolveScopeTargetLabel(
  inventory: any,
  scopeType: string,
  target: string,
  t: any = () => '',
): string {
  const match = buildScopeOptions(inventory, scopeType, t).find(o => o.id === target)

  return match?.label ?? target
}

/**
 * Compact, human-readable label for a stored scope target using only a
 * connection id -> name map (issue #383). Lighter than {@link
 * resolveScopeTargetLabel}: it needs no full inventory, so callers that only
 * list connections (e.g. the role cards) can still turn the opaque connection
 * id into its name. node/vm composite ids are formatted from their own parts;
 * tag/pool/global/inherit targets are already display-ready.
 */
export function formatScopeTarget(
  connNames: Record<string, string> | Map<string, string>,
  scopeType: string,
  target: string,
): string {
  const conn = (id: string) =>
    (connNames instanceof Map ? connNames.get(id) : connNames?.[id]) || id
  const parts = target.split(':')

  switch (scopeType) {
    case 'connection':
      return conn(target)
    case 'node':
      // "connId:node" -> "node · ConnectionName"
      return parts.length >= 2 ? `${parts[1]} · ${conn(parts[0])}` : target
    case 'vm':
      // "connId:node:type:vmid" -> "type/vmid · node"
      return parts.length >= 4 ? `${parts[2]}/${parts[3]} · ${parts[1]}` : target
    default:
      return target
  }
}
