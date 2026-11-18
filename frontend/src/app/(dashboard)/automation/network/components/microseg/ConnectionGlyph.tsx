'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { Box, useTheme } from '@mui/material'

import { NodeGlyph, nodeStatusColor } from '@/components/ui/glyphs'

import type { NamedConnection } from './clusterModel'

/**
 * What a PVE connection is: a cluster (two nodes or more) or a standalone node, with the state its dot shows; `nodes`,
 * the Proxmox nodes the same read listed with their state (the node view of the map draws them).
 */
export type ConnectionKind = {
  kind: 'cluster' | 'node'
  status: 'online' | 'maintenance' | 'offline' | 'unknown'
  nodes?: readonly { node: string; status?: string }[]
}

const UNKNOWN: ConnectionKind = { kind: 'cluster', status: 'unknown' }

/** The kind of a connection from its node list: one node is a standalone host, its dot is the node's state. */
export function connectionKind(nodes: readonly { status?: string }[] | undefined): ConnectionKind {
  if (!nodes || nodes.length === 0) return UNKNOWN
  const online = nodes.filter(n => n.status === 'online').length
  if (nodes.length === 1) return { kind: 'node', status: online === 1 ? 'online' : 'offline' }
  // A cluster: green with every node online, orange with some, red with none.
  let status: ConnectionKind['status'] = 'offline'
  if (online === nodes.length) status = 'online'
  else if (online > 0) status = 'maintenance'
  return { kind: 'cluster', status }
}

async function readKinds(ids: readonly string[]): Promise<Record<string, ConnectionKind>> {
  const entries = await Promise.all(ids.map(async id => {
    try {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(id)}/nodes`)
      if (!res.ok) return [id, UNKNOWN] as const
      const json = await res.json()
      const list: { node?: string; name?: string; status?: string }[] | undefined = Array.isArray(json?.data) ? json.data : undefined
      const nodes = (list ?? []).flatMap(n => {
        const node = n.node || n.name
        return node ? [{ node, ...(n.status ? { status: n.status } : {}) }] : []
      })
      return [id, { ...connectionKind(list), nodes }] as const
    } catch {
      return [id, UNKNOWN] as const
    }
  }))
  return Object.fromEntries(entries)
}

/**
 * The kinds the page already read for its connections: a component under it shows them without reading again.
 * Null outside the page (a dialog rendered alone reads its own).
 */
export const ConnectionKindsContext = createContext<Record<string, ConnectionKind> | null>(null)

/**
 * The Proxmox nodes of each connection the page read (by connection ID), with their state; empty outside the page.
 * Read with the kinds: no request of its own.
 */
export function useConnectionNodes(): Readonly<Record<string, ConnectionKind['nodes']>> {
  const kinds = useContext(ConnectionKindsContext)
  return useMemo(() => Object.fromEntries(Object.entries(kinds ?? {}).map(([id, k]) => [id, k.nodes])), [kinds])
}

/** The kind of one connection, from the page's read; undefined while it is unknown or outside the page. */
export function useConnectionKind(id: string): ConnectionKind | undefined {
  return useContext(ConnectionKindsContext)?.[id]
}

/**
 * The kind of each connection: the page's read when there is one, else read once when the caller mounts or the list
 * changes (no polling): the node list of each connection, which the server keeps for 30 seconds. A connection that
 * cannot be read is unknown.
 */
export function useConnectionKinds(ids: readonly string[], own = false): Record<string, ConnectionKind> {
  const shared = useContext(ConnectionKindsContext)
  const key = shared && !own ? '' : [...ids].sort().join(',')
  const [kinds, setKinds] = useState<Record<string, ConnectionKind>>({})
  useEffect(() => {
    if (!key) return
    let cancelled = false
    void readKinds(key.split(',')).then(read => { if (!cancelled) setKinds(read) })
    return () => { cancelled = true }
  }, [key])
  return shared && !own ? shared : kinds
}

/**
 * The glyph at the head of a connection's line: the cluster icon for a cluster, the Proxmox logo for a standalone
 * node, each with its state dot, as everywhere else in the product.
 */
export default function ConnectionGlyph({ kind, className }: Readonly<{ kind?: ConnectionKind; className?: string }>) {
  const theme = useTheme()
  const dotBorder = theme.palette.background.paper
  const shown = kind ?? UNKNOWN
  const status = shown.status === 'unknown' ? undefined : shown.status
  if (shown.kind === 'node') return <Box component='span' className={className} sx={{ display: 'inline-flex', flexShrink: 0 }}><NodeGlyph status={status} dark={theme.palette.mode === 'dark'} dotBorder={dotBorder} testId='connection-glyph-node' /></Box>
  return (
    <Box component='span' className={className} data-testid='connection-glyph-cluster' sx={{ position: 'relative', width: 16, height: 16, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      <i className='ri-server-line' style={{ fontSize: '0.9286rem', opacity: 0.8 }} aria-hidden />
      <Box component='span' data-testid='connection-glyph-cluster-dot' data-status={shown.status} aria-hidden sx={{ position: 'absolute', bottom: -1, right: -2, width: 6, height: 6, borderRadius: '50%', bgcolor: nodeStatusColor(status), border: `1px solid ${dotBorder}` }} />
    </Box>
  )
}

/** A connection on one line: its glyph, then its name, cut with an ellipsis. */
export function ConnectionLine({ name, kind }: Readonly<{ name: string; kind?: ConnectionKind }>) {
  return (
    <Box component='span' sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      <ConnectionGlyph kind={kind} />
      <Box component='span' sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</Box>
    </Box>
  )
}

/** The most connections a selector entry names; a larger group names the first ones and counts the rest. */
export const SHOWN_CONNECTIONS = 3

/**
 * The connections of one selector entry on one line: each with its glyph, joined by " + " when a policy is shared
 * ("PVE-DR + PVE-PROD"); each name is cut with an ellipsis rather than pushed out. A group larger than
 * SHOWN_CONNECTIONS names its first two and counts the others ("PVE-DR + PVE-LAB3 +6"), so the names shown stay
 * readable whatever the size of the group; `title` carries the full list.
 */
export function ConnectionsLabel({ connections, kinds, title }: Readonly<{ connections: readonly NamedConnection[]; kinds: Record<string, ConnectionKind>; title?: string }>) {
  const shown = connections.length > SHOWN_CONNECTIONS ? connections.slice(0, SHOWN_CONNECTIONS - 1) : connections
  const more = connections.length - shown.length
  return (
    <Box component='span' title={title} sx={{ display: 'flex', alignItems: 'center', minWidth: 0, overflow: 'hidden' }}>
      {shown.map((c, i) => (
        <Box key={c.id} component='span' sx={{ display: 'flex', alignItems: 'center', minWidth: 0, flexShrink: 1 }}>
          {i > 0 ? <Box component='span' sx={{ whiteSpace: 'pre', flexShrink: 0 }}>{' + '}</Box> : null}
          <ConnectionLine name={c.name} kind={kinds[c.id]} />
        </Box>
      ))}
      {more > 0 ? <Box component='span' data-testid='connections-more' sx={{ whiteSpace: 'pre', flexShrink: 0, color: 'text.secondary' }}>{` +${more}`}</Box> : null}
    </Box>
  )
}
