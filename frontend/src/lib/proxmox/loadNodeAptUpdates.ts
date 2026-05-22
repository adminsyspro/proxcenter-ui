/**
 * Reduce the per-node update map to a single description of which nodes
 * have an outstanding API-token permission problem (typically Sys.Modify),
 * so the cluster Rolling Update tab can render a single aggregated alert
 * instead of a banner per node. Returns null when no node is affected.
 */
export function aggregatePermissionErrors(
  nodeUpdates: Record<string, { permissionError?: string | null } | undefined>,
): { nodes: string[]; permission: string } | null {
  const affected: { node: string; permission: string }[] = []
  for (const [node, entry] of Object.entries(nodeUpdates)) {
    const perm = entry?.permissionError
    if (perm) {
      affected.push({ node, permission: perm })
    }
  }
  if (affected.length === 0) return null
  return {
    nodes: affected.map(a => a.node),
    permission: affected[0].permission,
  }
}

export interface AptUpdateEntry {
  count: number
  updates: any[]
  version: string | null
  loading: boolean
  permissionError?: string | null
}

export type SetNodeUpdates = (
  updater: (prev: Record<string, AptUpdateEntry>) => Record<string, AptUpdateEntry>,
) => void

export interface LoadNodeAptUpdatesOptions {
  connId: string
  nodeName: string
  setNodeUpdates: SetNodeUpdates
  /**
   * Last-resort version to display when neither the pve-manager package
   * update nor the apt route's fresh nodeVersion are available. Used by
   * the cluster Rolling Update tab to fall back on the pveversion already
   * cached on data.nodesData.
   */
  versionFallback?: string | null
  /**
   * When true, trigger an apt update (POST) before reading the package
   * list (GET). The default flow GETs first and only POSTs when the route
   * signals needsRefresh. Used by the per-node Refresh button.
   */
  forceRefresh?: boolean
  /** Test injection seam. */
  fetcher?: typeof fetch
}

export async function loadNodeAptUpdates({
  connId,
  nodeName,
  setNodeUpdates,
  versionFallback = null,
  forceRefresh = false,
  fetcher = fetch,
}: LoadNodeAptUpdatesOptions): Promise<void> {
  const aptUrl = `/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(nodeName)}/apt`

  const apply = (json: any, permErrorOverride?: string) => {
    const pvePkg = (json.data || []).find((p: any) => p.package === 'pve-manager')
    const pveVersion = pvePkg?.currentVersion || json.nodeVersion || versionFallback || null
    const permError = permErrorOverride || json.permissionError || null
    setNodeUpdates(prev => ({
      ...prev,
      [nodeName]: {
        count: json.count || 0,
        updates: json.data || [],
        version: pveVersion,
        loading: false,
        permissionError: permError,
      },
    }))
  }

  const refreshFromPost = async (): Promise<void> => {
    const postRes = await fetcher(aptUrl, { method: 'POST' })
    if (postRes.status === 403) {
      const postJson = await postRes.json()
      const refreshed = await fetcher(aptUrl)
        .then(r => r.json())
        .catch(() => ({ data: [], count: 0 }))
      apply(refreshed, postJson.requiredPermission || 'Sys.Modify')
      return
    }
    const fresh = await fetcher(aptUrl).then(r => r.json())
    apply(fresh)
  }

  try {
    if (forceRefresh) {
      await refreshFromPost()
      return
    }
    const json = await fetcher(aptUrl).then(r => r.json())
    if (json.needsRefresh) {
      await refreshFromPost()
      return
    }
    apply(json)
  } catch {
    setNodeUpdates(prev => ({
      ...prev,
      [nodeName]: { count: 0, updates: [], version: null, loading: false, permissionError: null },
    }))
  }
}
