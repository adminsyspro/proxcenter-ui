'use client'

import React, { useEffect, useMemo, useState } from 'react'
import {
  Box, Card, CardContent, CircularProgress, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Tooltip as MuiTooltip, Typography, useTheme,
} from '@mui/material'
import { buildCrushTopology, capacityColor, type CrushNode } from './cephTopology'

// Theme-aware tooltip styling, mirroring InventoryTree's tooltipSlotProps.
const useTooltipSlotProps = () => {
  const theme = useTheme()
  return {
    tooltip: { sx: { bgcolor: 'background.paper', color: 'text.primary', border: `1px solid ${theme.palette.divider}`, boxShadow: 3, fontSize: '0.75rem' } },
    arrow: { sx: { color: 'background.paper' } },
  }
}

function CapacityBar({ pct }: Readonly<{ pct: number }>) {
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, ml: 1 }}>
      <Box sx={{ width: 70, height: 6, borderRadius: 1, bgcolor: 'action.hover', overflow: 'hidden' }}>
        <Box sx={{ width: `${Math.min(pct, 100)}%`, height: '100%', bgcolor: `${capacityColor(pct)}.main` }} />
      </Box>
      <Typography variant="caption" sx={{ minWidth: 34, textAlign: 'right' }}>{pct}%</Typography>
    </Box>
  )
}

function DaemonChips({ d }: Readonly<{ d: NonNullable<CrushNode['daemons']> }>) {
  const chip = (label: string, on: boolean, color: string) => on ? (
    <Box component="span" sx={{ ml: 0.5, px: 0.75, py: 0.1, borderRadius: 1, fontSize: '0.65rem', bgcolor: `${color}.dark`, color: `${color}.contrastText` }}>{label}</Box>
  ) : null
  return <>{chip(d.monLeader ? 'mon ★' : 'mon', d.mon, 'success')}{chip('mgr', d.mgr, 'info')}{chip('mds', d.mds, 'secondary')}</>
}

function TreeRow({ node, depth, expanded, toggle, onSelect, selectedId }: Readonly<{
  node: CrushNode; depth: number; expanded: Set<string>; toggle: (k: string) => void
  onSelect: (n: CrushNode) => void; selectedId: string
}>) {
  const key = `${node.type}:${node.id}:${node.name}`
  const hasChildren = !!node.children && node.children.length > 0
  const isOpen = expanded.has(key)
  return (
    <Box>
      <Box
        onClick={() => onSelect(node)}
        sx={{
          display: 'flex', alignItems: 'center', py: 0.25, pl: `${depth * 18}px`, borderRadius: 1, cursor: 'pointer',
          bgcolor: selectedId === key ? 'action.selected' : 'transparent', '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <Box
          component="span"
          onClick={(e) => { e.stopPropagation(); if (hasChildren) toggle(key) }}
          sx={{ width: 18, color: 'primary.main', visibility: hasChildren ? 'visible' : 'hidden' }}
        >
          <i className={isOpen ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} />
        </Box>
        <Typography variant="body2" component="span" sx={{ color: node.type === 'osd' ? 'text.primary' : 'text.secondary' }}>
          {node.type !== 'osd' && node.type !== 'root' ? `${node.type} ` : ''}<b>{node.name}</b>
        </Typography>
        {node.osd && (
          <>
            <Box component="span" sx={{ ml: 0.5, px: 0.75, borderRadius: 1, fontSize: '0.65rem', bgcolor: node.osd.up && node.osd.in ? 'success.dark' : 'error.dark', color: 'common.white' }}>
              {node.osd.up ? 'up' : 'down'}/{node.osd.in ? 'in' : 'out'}
            </Box>
            <Box component="span" sx={{ ml: 0.5, px: 0.75, borderRadius: 1, fontSize: '0.65rem', bgcolor: 'action.hover' }}>{node.osd.deviceClass}</Box>
          </>
        )}
        {node.type === 'host' && node.daemons && <DaemonChips d={node.daemons} />}
        {node.totalBytes > 0 && <CapacityBar pct={node.usedPct} />}
      </Box>
      {hasChildren && isOpen && node.children!.map((c) => (
        <TreeRow key={`${c.type}:${c.id}:${c.name}`} node={c} depth={depth + 1} expanded={expanded} toggle={toggle} onSelect={onSelect} selectedId={selectedId} />
      ))}
    </Box>
  )
}

function DetailsPanel({ node }: Readonly<{ node: CrushNode | null }>) {
  if (!node) return <Typography variant="caption" sx={{ opacity: 0.6 }}>Select a node to see details.</Typography>
  const rows: [string, string][] = [['Type', node.type], ['Capacity', node.totalBytes > 0 ? `${node.usedPct}%` : 'n/a']]
  if (node.osd) rows.push(['Status', `${node.osd.up ? 'up' : 'down'} / ${node.osd.in ? 'in' : 'out'}`], ['Class', node.osd.deviceClass])
  if (node.daemons) rows.push(['Daemons', [node.daemons.monLeader ? 'mon (leader)' : node.daemons.mon ? 'mon' : '', node.daemons.mgr ? 'mgr' : '', node.daemons.mds ? 'mds' : ''].filter(Boolean).join(', ') || 'none'])
  return (
    <Box>
      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>{node.name}</Typography>
      {rows.map(([k, v]) => (
        <Box key={k} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.25, borderBottom: '1px dashed', borderColor: 'divider' }}>
          <Typography variant="caption" color="text.secondary">{k}</Typography>
          <Typography variant="caption" fontWeight={600}>{v}</Typography>
        </Box>
      ))}
    </Box>
  )
}

export default function CephTopology({ connId }: Readonly<{ connId: string }>) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<CrushNode | null>(null)
  const tooltipSlotProps = useTooltipSlotProps()

  useEffect(() => {
    if (!connId) return
    let cancelled = false
    setLoading(true); setError(false)
    fetch(`/api/v1/connections/${encodeURIComponent(connId)}/ceph`, { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then((json) => { if (!cancelled) setData(json.data ?? json) })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [connId])

  const { tree, poolRules } = useMemo(() => buildCrushTopology(data ?? {}), [data])

  // Expand the first two levels by default once data arrives.
  useEffect(() => {
    if (!tree.length) return
    const next = new Set<string>()
    for (const root of tree) {
      next.add(`${root.type}:${root.id}:${root.name}`)
      for (const lvl1 of root.children ?? []) next.add(`${lvl1.type}:${lvl1.id}:${lvl1.name}`)
    }
    setExpanded(next)
  }, [tree])

  const toggle = (k: string) => setExpanded((prev) => {
    const next = new Set(prev)
    if (next.has(k)) next.delete(k); else next.add(k)
    return next
  })

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={22} /></Box>
  if (error) return <Typography variant="body2" sx={{ opacity: 0.6 }}>Ceph not available on this cluster.</Typography>
  if (!tree.length) return <Typography variant="body2" sx={{ opacity: 0.6 }}>Topology unavailable.</Typography>

  const selectedId = selected ? `${selected.type}:${selected.id}:${selected.name}` : ''

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1.6fr 1fr' }, gap: 2 }}>
        <Card variant="outlined"><CardContent>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>CRUSH tree</Typography>
          {tree.map((n) => (
            <TreeRow key={`${n.type}:${n.id}:${n.name}`} node={n} depth={0} expanded={expanded} toggle={toggle} onSelect={setSelected} selectedId={selectedId} />
          ))}
        </CardContent></Card>
        <Card variant="outlined"><CardContent>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Details</Typography>
          <DetailsPanel node={selected} />
        </CardContent></Card>
      </Box>
      <Card variant="outlined"><CardContent>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Pools → CRUSH rules</Typography>
        {poolRules.length > 0 ? (
          <TableContainer><Table size="small">
            <TableHead><TableRow>
              <TableCell sx={{ fontWeight: 700 }}>Pool</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Rule</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Target</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Size</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>%used</TableCell>
            </TableRow></TableHead>
            <TableBody>{poolRules.map((p) => (
              <TableRow key={p.pool}>
                <TableCell>{p.pool}</TableCell><TableCell>{p.ruleName}</TableCell>
                <MuiTooltip title="CRUSH rule 'take' target bucket/class" arrow slotProps={tooltipSlotProps}><TableCell>{p.target}</TableCell></MuiTooltip>
                <TableCell>{p.size}</TableCell><TableCell>{p.usedPct}%</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table></TableContainer>
        ) : <Typography variant="caption" sx={{ opacity: 0.6 }}>No pools.</Typography>}
      </CardContent></Card>
    </Stack>
  )
}
