'use client'

import { useEffect, useState, useCallback } from 'react'

import { useTranslations } from 'next-intl'

import {
  Box, Checkbox, CircularProgress, FormControlLabel, IconButton, Stack, Typography,
} from '@mui/material'

import { ClusterIcon, NodeIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'

interface ConnectionItem {
  id: string
  name: string
  type: string
}

interface NodeItem {
  nodeName: string
  status?: string | null
}

export interface AssignmentState {

  /** Connection IDs assigned to this DC at the cluster level. */
  clusters: Set<string>

  /** "connectionId|nodeName" pairs assigned to this DC at the node level. */
  nodes: Set<string>
}

interface Props {

  /** Disabled while the parent dialog is in a loading state. */
  disabled?: boolean
  state: AssignmentState
  onChange: (next: AssignmentState) => void

  /** Initial assignments from the server, used to compute the "expand by default" set. */
  initialState: AssignmentState

  /** ID of the DC currently being edited (or null when creating). Used to grey out rows already on other DCs. */
  currentDcId?: string | null
}

interface OwnershipMap {
  clusters: Record<string, { datacenterId: string; datacenterName: string }>
  nodes: Record<string, { datacenterId: string; datacenterName: string }>
}

function nodeKey(connId: string, nodeName: string) {
  return `${connId}|${nodeName}`
}

export default function DatacenterAssignmentTree({ disabled, state, onChange, initialState, currentDcId }: Props) {
  const t = useTranslations()
  const [connections, setConnections] = useState<ConnectionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [nodesByConn, setNodesByConn] = useState<Record<string, NodeItem[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [nodesLoading, setNodesLoading] = useState<Set<string>>(new Set())
  const [ownership, setOwnership] = useState<OwnershipMap>({ clusters: {}, nodes: {} })

  // Load PVE connections + their node lists + the global ownership map.
  // Pre-fetching everything up front keeps the cluster-level health dot
  // accurate AND lets us grey out rows already anchored to another DC.
  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const [connRes, ownRes] = await Promise.all([
          fetch('/api/v1/connections?type=pve'),
          fetch('/api/v1/admin/green-assignments'),
        ])

        if (!connRes.ok) throw new Error(`HTTP ${connRes.status}`)
        const json = await connRes.json()

        if (cancelled) return

        const list: ConnectionItem[] = (Array.isArray(json?.data) ? json.data : [])
          .filter((c: any) => c.type === 'pve')
          .map((c: any) => ({ id: c.id, name: c.name, type: c.type }))

        setConnections(list)

        if (ownRes.ok) {
          const ownJson = await ownRes.json()

          if (!cancelled && ownJson?.data) {
            setOwnership({
              clusters: ownJson.data.clusters ?? {},
              nodes: ownJson.data.nodes ?? {},
            })
          }
        }

        const auto = new Set<string>()

        for (const c of list) {
          if (initialState.clusters.has(c.id)) auto.add(c.id)
          if ([...initialState.nodes].some(k => k.startsWith(`${c.id}|`))) auto.add(c.id)
        }

        setExpanded(auto)

        // Eagerly fetch every cluster's node list — needed for the health dot.
        const results = await Promise.all(list.map(async c => {
          try {
            const r = await fetch(`/api/v1/admin/connections/${encodeURIComponent(c.id)}/green-config`)

            if (!r.ok) return [c.id, [] as NodeItem[]] as const
            const j = await r.json()

            const nodes: NodeItem[] = (Array.isArray(j?.data?.nodes) ? j.data.nodes : []).map((n: any) => ({
              nodeName: n.nodeName,
              status: n.status ?? null,
            }))


return [c.id, nodes] as const
          } catch {
            return [c.id, [] as NodeItem[]] as const
          }
        }))

        if (cancelled) return
        const map: Record<string, NodeItem[]> = {}

        for (const [id, nodes] of results) map[id] = nodes
        setNodesByConn(map)
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()


return () => { cancelled = true }
  }, [initialState])

  const loadNodesFor = useCallback(async (connId: string) => {
    if (nodesByConn[connId]) return
    setNodesLoading(s => { const n = new Set(s);

 n.add(connId);

return n })

    try {
      // Re-use the existing green-config GET which returns the merged saved + live node list.
      const res = await fetch(`/api/v1/admin/connections/${encodeURIComponent(connId)}/green-config`)

      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()

      const nodes: NodeItem[] = (Array.isArray(json?.data?.nodes) ? json.data.nodes : []).map((n: any) => ({
        nodeName: n.nodeName,
        status: n.status ?? null,
      }))

      setNodesByConn(s => ({ ...s, [connId]: nodes }))
    } catch {
      setNodesByConn(s => ({ ...s, [connId]: [] }))
    } finally {
      setNodesLoading(s => { const n = new Set(s);

 n.delete(connId);

return n })
    }
  }, [nodesByConn])

  // Load node lists for any cluster that's expanded.
  useEffect(() => {
    for (const connId of expanded) {
      if (!nodesByConn[connId] && !nodesLoading.has(connId)) void loadNodesFor(connId)
    }
  }, [expanded, nodesByConn, nodesLoading, loadNodesFor])

  const toggleExpand = (connId: string) => {
    setExpanded(s => {
      const n = new Set(s)

      if (n.has(connId)) n.delete(connId)
      else n.add(connId)

return n
    })
  }

  const toggleCluster = (connId: string) => {
    const next: AssignmentState = {
      clusters: new Set(state.clusters),
      nodes: new Set(state.nodes),
    }

    if (next.clusters.has(connId)) {
      next.clusters.delete(connId)
    } else {
      next.clusters.add(connId)


      // Cluster pick wins over per-node — clear partial node assignments.
      for (const k of [...next.nodes]) {
        if (k.startsWith(`${connId}|`)) next.nodes.delete(k)
      }
    }

    onChange(next)
  }

  const toggleNode = (connId: string, nodeName: string) => {
    const k = nodeKey(connId, nodeName)

    const next: AssignmentState = {
      clusters: new Set(state.clusters),
      nodes: new Set(state.nodes),
    }


    // Checking a single node demotes the cluster from "all" to partial — drop
    // the cluster entry so only the explicitly checked nodes are anchored here.
    if (next.clusters.has(connId)) {
      next.clusters.delete(connId)

      // The cluster used to mean "all nodes here" — preserve that intent for
      // the other nodes in the cluster by switching them from implicit-all to
      // explicit-selected, then toggle the user's node off.
      const nodes = nodesByConn[connId] ?? []

      for (const n of nodes) next.nodes.add(nodeKey(connId, n.nodeName))
    }

    if (next.nodes.has(k)) next.nodes.delete(k)
    else next.nodes.add(k)
    onChange(next)
  }

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={20} /></Box>
  }

  if (connections.length === 0) {
    return <Typography variant="caption" color="text.secondary">{t('settings.green.dc.assignment.empty')}</Typography>
  }

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1, maxHeight: 280, overflow: 'auto' }}>
      {connections.map(conn => {
        const isClusterChecked = state.clusters.has(conn.id)
        const partialKeys = [...state.nodes].filter(k => k.startsWith(`${conn.id}|`))
        const partialNodeNames = new Set(partialKeys.map(k => k.split('|')[1]))
        const isExpanded = expanded.has(conn.id)
        const isNodesLoading = nodesLoading.has(conn.id)
        const nodes = nodesByConn[conn.id] ?? []
        const indeterminate = !isClusterChecked && partialNodeNames.size > 0

        // Cluster ownership: locked if currently anchored on a different DC.
        const clusterOwner = ownership.clusters[conn.id]
        const clusterLockedByOther = !!clusterOwner && clusterOwner.datacenterId !== currentDcId

        return (
          <Box key={conn.id}>
            <Stack direction="row" alignItems="center" spacing={0.5} sx={{ py: 0.5 }}>
              <IconButton
                size="small"
                onClick={() => toggleExpand(conn.id)}
                sx={{ p: 0.5 }}
                disabled={disabled}
              >
                <i
                  className={isExpanded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'}
                  style={{ fontSize: 16 }}
                />
              </IconButton>
              <FormControlLabel
                disabled={disabled || clusterLockedByOther}
                control={
                  <Checkbox
                    size="small"
                    checked={isClusterChecked}
                    indeterminate={indeterminate}
                    onChange={() => toggleCluster(conn.id)}
                  />
                }
                label={
                  <Stack direction="row" spacing={1} alignItems="center">
                    <ClusterIcon nodes={nodes} size={14} />
                    <Typography variant="body2" fontWeight={500}>{conn.name}</Typography>
                    {clusterLockedByOther && (
                      <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                        → {clusterOwner.datacenterName}
                      </Typography>
                    )}
                    {!clusterLockedByOther && indeterminate && (
                      <Typography variant="caption" color="text.secondary">
                        ({partialNodeNames.size} {t('settings.green.dc.assignment.partial')})
                      </Typography>
                    )}
                    {!clusterLockedByOther && isClusterChecked && (
                      <Typography variant="caption" color="primary">
                        {t('settings.green.dc.assignment.allNodes')}
                      </Typography>
                    )}
                  </Stack>
                }
              />
            </Stack>

            {isExpanded && (
              <Box sx={{ pl: 5 }}>
                {isNodesLoading ? (
                  <CircularProgress size={14} />
                ) : nodes.length === 0 ? (
                  <Typography variant="caption" color="text.secondary">
                    {t('settings.green.dc.assignment.noNodes')}
                  </Typography>
                ) : (
                  nodes.map(n => {
                    const checked = isClusterChecked || partialNodeNames.has(n.nodeName)
                    const nodeOwner = ownership.nodes[`${conn.id}|${n.nodeName}`]
                    const nodeLockedByOther = !!nodeOwner && nodeOwner.datacenterId !== currentDcId

                    // A node is also locked when its cluster is anchored elsewhere
                    // (the cluster pick wins by inheritance).
                    const lockedByCluster = clusterLockedByOther

                    const lockLabel = nodeLockedByOther
                      ? nodeOwner.datacenterName
                      : lockedByCluster
                        ? clusterOwner.datacenterName
                        : null


return (
                      <FormControlLabel
                        key={n.nodeName}
                        disabled={disabled || isClusterChecked || nodeLockedByOther || lockedByCluster}
                        sx={{ display: 'flex', py: 0.25 }}
                        control={
                          <Checkbox
                            size="small"
                            checked={checked}
                            onChange={() => toggleNode(conn.id, n.nodeName)}
                          />
                        }
                        label={
                          <Stack direction="row" spacing={0.75} alignItems="center">
                            <NodeIcon status={n.status ?? undefined} size={14} />
                            <Typography variant="caption">{n.nodeName}</Typography>
                            {lockLabel && (
                              <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                                → {lockLabel}
                              </Typography>
                            )}
                          </Stack>
                        }
                      />
                    )
                  })
                )}
              </Box>
            )}
          </Box>
        )
      })}
    </Box>
  )
}
