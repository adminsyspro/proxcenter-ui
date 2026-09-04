'use client'

import React, { useCallback, useMemo } from 'react'

import { useRouter } from 'next/navigation'

import { useTranslations } from 'next-intl'
import { Box, IconButton, Tooltip, Typography, useTheme } from '@mui/material'

import ConnectionFilter from './ConnectionFilter'
import { widgetColors } from './themeColors'

// ─── Helpers ─────────────────────────────────────────────────────────────────
// Same thresholds as Top Consumers, so a guest keeps its colour from one
// widget to the next.
function getBarColor(value) {
  if (value >= 80) return '#ef4444'
  if (value >= 50) return '#f59e0b'

  return '#22c55e'
}

const STATUS_COLORS = { running: '#4caf50', stopped: '#f44336', paused: '#ff9800', suspended: '#ff9800' }
const getStatusColor = (status) => STATUS_COLORS[status] || '#616161'

const NODE_STATUS_COLORS = { online: '#4caf50', unknown: '#9e9e9e' }
const getNodeStatusColor = (status) => NODE_STATUS_COLORS[status] || '#f44336'

// Two clusters may both have a node called "pve1": the node key carries the
// connection so their guests never end up in the same group. A cluster is
// keyed by its bare connection id, which never carries a colon suffix.
const nodeKey = (connId, node) => `${connId}:${node}`
const pct = (value) => Math.round(Number(value) || 0)
const num = (value) => Number(value) || 0

// One grid for the three levels, so the CPU and RAM columns line up down the
// whole tree. The depth shows through the left padding of the first cell.
const GRID_COLUMNS = 'minmax(0, 1fr) minmax(64px, 88px) minmax(64px, 88px)'
const INDENT = { cluster: 0, node: 2.25, guest: 4.5 }
const MONO = '"JetBrains Mono", monospace'

function MetricBar({ value, c }) {
  // Node percentages arrive with one decimal, guests are already whole.
  const v = Math.max(0, Math.min(100, pct(value)))
  const color = getBarColor(v)

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
      <Box sx={{ flex: 1, height: 5, borderRadius: 3, bgcolor: c.surfaceSubtle, overflow: 'hidden' }}>
        <Box sx={{ width: `${v}%`, height: '100%', borderRadius: 3, bgcolor: color, transition: 'width 0.4s ease' }} />
      </Box>
      <Typography sx={{ fontSize: '0.6786rem', fontWeight: 600, fontFamily: MONO, color, width: 30, textAlign: 'right', flexShrink: 0, lineHeight: 1.2 }}>
        {v}%
      </Typography>
    </Box>
  )
}

// The two metric cells of a header row: bars when the level has a load of
// its own, blank cells otherwise (a node the API did not list, a cluster with
// no node in scope).
function MetricCells({ hasLoad, cpuPct, memPct, c }) {
  if (!hasLoad) return <><span /><span /></>

  return <><MetricBar value={cpuPct} c={c} /><MetricBar value={memPct} c={c} /></>
}

// ─── Rows ────────────────────────────────────────────────────────────────────
// A focusable, collapsible header row shared by the cluster and node levels.
function TreeHeader({ collapsed, onToggle, indent, metrics, sx, c, children }) {
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() }
  }

  return (
    <Box
      role='button'
      tabIndex={0}
      aria-expanded={!collapsed}
      onClick={onToggle}
      onKeyDown={handleKeyDown}
      sx={{
        display: 'grid', gridTemplateColumns: GRID_COLUMNS, alignItems: 'center', columnGap: 1,
        px: 0.5, py: 0.4, borderRadius: 1, cursor: 'pointer', userSelect: 'none',
        ...sx,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, pl: indent }}>
        <i className={collapsed ? 'ri-arrow-right-s-line' : 'ri-arrow-down-s-line'} style={{ fontSize: '1rem', color: c.textMuted, flexShrink: 0 }} />
        {children}
      </Box>
      {metrics}
    </Box>
  )
}

function ClusterRow({ cluster, collapsed, onToggle, c, t }) {
  return (
    <TreeHeader
      collapsed={collapsed}
      onToggle={onToggle}
      indent={INDENT.cluster}
      c={c}
      sx={{ bgcolor: c.surfaceHover, '&:hover': { bgcolor: c.surfaceActive } }}
      metrics={<MetricCells hasLoad={cluster.hasLoad} cpuPct={cluster.cpuPct} memPct={cluster.memPct} c={c} />}
    >
      <i className='ri-server-line' style={{ fontSize: '0.9286rem', color: c.textSecondary, flexShrink: 0 }} />
      <Typography sx={{ fontWeight: 700, fontSize: '0.8214rem', color: c.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {cluster.name}
      </Typography>
      <Typography sx={{ fontSize: '0.6786rem', color: c.textMuted, whiteSpace: 'nowrap', flexShrink: 0 }}>
        {t('dashboard.nodeGuests.nodes', { count: cluster.nodes.length })}
      </Typography>
      <Typography sx={{ fontSize: '0.6786rem', color: c.textMuted, fontFamily: MONO, flexShrink: 0 }}>
        {`${cluster.running}/${cluster.total}`}
      </Typography>
    </TreeHeader>
  )
}

function NodeRow({ group, collapsed, onToggle, isDark, c }) {
  const online = group.status === 'online'

  return (
    <TreeHeader
      collapsed={collapsed}
      onToggle={onToggle}
      indent={INDENT.node}
      c={c}
      sx={{ '&:hover': { bgcolor: c.surfaceHover } }}
      metrics={<MetricCells hasLoad={group.hasLoad} cpuPct={group.cpuPct} memPct={group.memPct} c={c} />}
    >
      {/* A node is the Proxmox logo with its status dot, as in Nodes Status
          and the Guest Map. */}
      <Box sx={{ position: 'relative', width: 16, height: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img src={isDark ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt='' width={14} height={14} style={{ opacity: online ? 0.8 : 0.4 }} />
        <Box sx={{ position: 'absolute', bottom: -1, right: -2, width: 6, height: 6, borderRadius: '50%', bgcolor: getNodeStatusColor(group.status), border: `1px solid ${c.dotBorder}` }} />
      </Box>
      <Typography sx={{ fontWeight: 700, fontSize: '0.7857rem', color: c.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {group.node}
      </Typography>
      <Typography sx={{ fontSize: '0.6786rem', color: c.textMuted, fontFamily: MONO, flexShrink: 0 }}>
        {`${group.running}/${group.guests.length}`}
      </Typography>
    </TreeHeader>
  )
}

function GuestRow({ vm, onOpen, c }) {
  return (
    <Box
      onClick={() => onOpen(vm)}
      sx={{
        display: 'grid', gridTemplateColumns: GRID_COLUMNS, alignItems: 'center', columnGap: 1,
        px: 0.5, py: 0.3, borderRadius: 1, cursor: 'pointer', transition: 'background 0.15s',
        '&:hover': { bgcolor: c.surfaceHover },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, pl: INDENT.guest }}>
        {/* A guest has no chevron: the empty slot keeps it one full step
            deeper than its node, icon under icon. */}
        <Box sx={{ width: 16, flexShrink: 0 }} />
        <Box sx={{ position: 'relative', width: 16, height: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <i className={vm.type === 'lxc' ? 'ri-instance-line' : 'ri-computer-line'} style={{ fontSize: '0.9286rem', color: c.textSecondary }} />
          <Box sx={{ position: 'absolute', bottom: -1, right: -2, width: 6, height: 6, borderRadius: '50%', bgcolor: getStatusColor(vm.status), border: `1px solid ${c.dotBorder}` }} />
        </Box>
        <Typography sx={{ fontSize: '0.7857rem', fontWeight: 500, color: c.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {vm.name || `VM ${vm.vmid}`}
        </Typography>
        <Typography sx={{ fontSize: '0.6429rem', color: c.textFaint, flexShrink: 0 }}>#{vm.vmid}</Typography>
      </Box>
      {/* A stopped guest simply reads 0 %: the status dot says the rest. */}
      <MetricBar value={vm.cpuPct} c={c} />
      <MetricBar value={vm.ramPct} c={c} />
    </Box>
  )
}

// ─── Tree ────────────────────────────────────────────────────────────────────
const emptyNode = (connId, nodeName) => ({
  key: nodeKey(connId, nodeName), connId, node: nodeName, status: 'unknown',
  cpuPct: 0, memPct: 0, cores: 0, cpuUsage: 0, memUsed: 0, memMax: 0, hasLoad: false, guests: [],
})

const mean = (rows, pick) => (rows.length ? rows.reduce((sum, r) => sum + num(pick(r)), 0) / rows.length : 0)

// Cluster load from its nodes: CPU weighted by core count and RAM as a plain
// sum when the API gave the raw figures, a mean of the node percentages
// otherwise.
function clusterLoad(nodes) {
  const real = nodes.filter(n => n.hasLoad)
  const cores = real.reduce((sum, n) => sum + n.cores, 0)
  const memMax = real.reduce((sum, n) => sum + n.memMax, 0)

  return {
    hasLoad: real.length > 0,
    cpuPct: cores > 0 ? (real.reduce((sum, n) => sum + n.cpuUsage * n.cores, 0) / cores) * 100 : mean(real, n => n.cpuPct),
    memPct: memMax > 0 ? (real.reduce((sum, n) => sum + n.memUsed, 0) / memMax) * 100 : mean(real, n => n.memPct),
  }
}

// The API lists every connection of the tenant in `clusters` BEFORE its RBAC
// filter; only `nodes` and the guest lists are filtered. Cluster rows are
// therefore derived from those two, and `clusters` only lends the real PVE
// cluster names.
const clusterNames = (data) => new Map((data?.clusters || []).map(cl => [cl.id, cl.name]))

// Connections that carry at least one visible node or guest, before the
// widget's own connection filter: what the filter menu may offer.
function presentConnections(data) {
  const names = clusterNames(data)
  const seen = new Map()

  for (const n of data?.nodes || []) if (!seen.has(n.connId)) seen.set(n.connId, names.get(n.connId) || n.connection || n.connId)

  for (const g of [...(data?.vmList || []), ...(data?.lxcList || [])]) {
    if (!g.template && !seen.has(g.connId)) seen.set(g.connId, names.get(g.connId) || g.connName || g.connId)
  }

  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
}

function buildTree(data, inScope) {
  const names = clusterNames(data)
  const clusters = new Map()

  const ensureCluster = (connId, fallbackName) => {
    if (!clusters.has(connId)) clusters.set(connId, { key: connId, name: names.get(connId) || fallbackName || connId, nodes: new Map() })

    return clusters.get(connId)
  }

  // Every node the API knows comes first, so an idle node still shows up
  // with its own load.
  for (const n of data?.nodes || []) {
    if (!inScope(n.connId)) continue

    ensureCluster(n.connId, n.connection).nodes.set(nodeKey(n.connId, n.node), {
      ...emptyNode(n.connId, n.node),
      status: n.status, cpuPct: n.cpuPct, memPct: n.memPct, hasLoad: true,
      cores: num(n._cpuCores), cpuUsage: num(n._cpuUsage), memUsed: num(n._memUsed), memMax: num(n._memMax),
    })
  }

  const guests = [...(data?.vmList || []), ...(data?.lxcList || [])].filter(g => !g.template && inScope(g.connId))

  for (const g of guests) {
    const nodeName = g.node || 'unknown'
    const cluster = ensureCluster(g.connId, g.connName)
    const key = nodeKey(g.connId, nodeName)

    if (!cluster.nodes.has(key)) cluster.nodes.set(key, emptyNode(g.connId, nodeName))

    const mem = num(g.mem)
    const maxmem = num(g.maxmem)

    cluster.nodes.get(key).guests.push({ ...g, cpuPct: pct(num(g.cpu) * 100), ramPct: maxmem > 0 ? pct((mem / maxmem) * 100) : 0 })
  }

  const tree = [...clusters.values()].map((cl) => {
    const nodes = [...cl.nodes.values()]

    for (const group of nodes) {
      // Running guests first, then by name: a stable order for a routine
      // check, the bar colours already single out the hot ones.
      group.guests.sort((a, b) => {
        const ar = a.status === 'running'
        const br = b.status === 'running'

        if (ar !== br) return ar ? -1 : 1

        return (a.name || '').localeCompare(b.name || '')
      })
      group.running = group.guests.filter(g => g.status === 'running').length
    }

    nodes.sort((a, b) => a.node.localeCompare(b.node))

    return {
      key: cl.key, name: cl.name, nodes, ...clusterLoad(nodes),
      running: nodes.reduce((sum, n) => sum + n.running, 0),
      total: nodes.reduce((sum, n) => sum + n.guests.length, 0),
    }
  })

  tree.sort((a, b) => a.name.localeCompare(b.name))

  return tree
}

// ─── Main Widget ─────────────────────────────────────────────────────────────
function NodeGuestsWidget({ data, loading: dashboardLoading, config, onUpdateSettings }) {
  const t = useTranslations()
  const theme = useTheme()
  const router = useRouter()
  const isDark = theme.palette.mode === 'dark'
  const c = widgetColors(isDark)

  const settings = config?.settings || {}
  const selectedConnections = useMemo(() => settings.selectedConnections || [], [settings.selectedConnections])
  // The tree starts fully collapsed: the settings hold what the user opened.
  const expanded = settings.expanded || []
  const update = useCallback((patch) => { if (onUpdateSettings) onUpdateSettings(patch) }, [onUpdateSettings])

  const allConnections = useMemo(() => presentConnections(data), [data])
  const inScope = useCallback((connId) => selectedConnections.length === 0 || selectedConnections.includes(connId), [selectedConnections])

  // Count before any filter, to tell "your filter hid everything" apart from
  // "there is nothing to show at all".
  const hasAnything = useMemo(
    () => (data?.nodes || []).length > 0 || [...(data?.vmList || []), ...(data?.lxcList || [])].some(g => !g.template),
    [data?.nodes, data?.vmList, data?.lxcList],
  )

  const tree = useMemo(() => buildTree(data, inScope), [data, inScope])

  const stats = useMemo(() => ({
    total: tree.reduce((sum, cl) => sum + cl.total, 0),
    running: tree.reduce((sum, cl) => sum + cl.running, 0),
  }), [tree])

  const toggle = (key) => update({ expanded: expanded.includes(key) ? expanded.filter(k => k !== key) : [...expanded, key] })
  const expandAll = () => update({ expanded: tree.flatMap(cl => [cl.key, ...cl.nodes.map(n => n.key)]) })
  const collapseAll = () => update({ expanded: [] })
  const handleFilterChange = (next) => update({ selectedConnections: next })

  const openGuest = useCallback((vm) => {
    router.push(`/infrastructure/inventory?vmid=${vm.vmid}&connId=${vm.connId}&node=${vm.node}&type=${vm.type}`)
  }, [router])

  const darkCard = {
    bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
    border: '1px solid', borderColor: c.borderLight,
    borderRadius: 'var(--proxcenter-card-radius)', p: 1.5,
    transition: 'border-color 0.2s, box-shadow 0.2s',
    '&:hover': { borderColor: c.borderHover, boxShadow: isDark ? '0 2px 8px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.08)' },
  }

  if (!data || dashboardLoading) {
    return <Box sx={{ height: '100%', ...darkCard, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Typography sx={{ opacity: 0.4, fontSize: '0.7857rem' }}>Loading...</Typography></Box>
  }

  if (!hasAnything) {
    return <Box sx={{ height: '100%', ...darkCard, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Typography sx={{ opacity: 0.4, fontSize: '0.7857rem' }}>{t('common.noData')}</Typography></Box>
  }

  const isEmpty = tree.length === 0

  return (
    <Box sx={{ height: '100%', ...darkCard, display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5, gap: 0.5, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <Typography sx={{ fontSize: '0.7143rem', opacity: 0.6 }}>{t('dashboard.nodeGuests.guests', { count: stats.total })}</Typography>
          <Typography sx={{ fontSize: '0.7143rem', color: '#4caf50', fontWeight: 600 }}>{t('dashboard.nodeGuests.running', { count: stats.running })}</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 0.25, alignItems: 'center' }}>
          <Tooltip title={t('common.expandAll')}>
            <IconButton size='small' aria-label={t('common.expandAll')} onClick={expandAll} sx={{ p: 0.25 }}>
              <i className='ri-expand-up-down-line' style={{ fontSize: '1rem' }} />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('common.collapseAll')}>
            <IconButton size='small' aria-label={t('common.collapseAll')} onClick={collapseAll} sx={{ p: 0.25 }}>
              <i className='ri-contract-up-down-line' style={{ fontSize: '1rem' }} />
            </IconButton>
          </Tooltip>
          {allConnections.length > 1 && <ConnectionFilter connections={allConnections} selected={selectedConnections} onChange={handleFilterChange} t={t} />}
        </Box>
      </Box>

      {/* Column captions, on the same grid as the rows */}
      {!isEmpty && (
        <Box sx={{ display: 'grid', gridTemplateColumns: GRID_COLUMNS, columnGap: 1, px: 0.5, mb: 0.25 }}>
          <span />
          <Typography sx={{ fontSize: '0.6429rem', color: c.textFaint, fontWeight: 600, letterSpacing: 0.5 }}>{t('monitoring.cpu')}</Typography>
          <Typography sx={{ fontSize: '0.6429rem', color: c.textFaint, fontWeight: 600, letterSpacing: 0.5 }}>RAM</Typography>
        </Box>
      )}

      {/* Tree. The empty state lives here, never in place of the toolbar, so
          the filter that emptied it stays reachable. */}
      <Box sx={{
        flex: 1, overflow: 'auto', minHeight: 0,
        ...(isEmpty && { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0.75 }),
      }}>
        {isEmpty && (
          <>
            <Typography sx={{ opacity: 0.4, fontSize: '0.7857rem' }}>{t('common.noResults')}</Typography>
            <Box onClick={() => handleFilterChange([])} sx={{
              px: 0.75, py: 0.2, borderRadius: 1, cursor: 'pointer', fontSize: '0.7143rem', fontWeight: 600,
              color: c.textMuted, bgcolor: c.borderLight,
              '&:hover': { bgcolor: c.surfaceSubtle, color: c.textPrimary },
            }}>{t('common.reset')}</Box>
          </>
        )}
        {!isEmpty && tree.map((cluster, ci) => {
          const clusterOpen = expanded.includes(cluster.key)

          return (
            // Clusters are set apart by a full-width rule, nodes inside a
            // cluster by a lighter one indented to their level.
            <Box key={cluster.key} sx={ci > 0 ? { mt: 1, pt: 0.75, borderTop: `1px solid ${c.border}` } : undefined}>
              <ClusterRow cluster={cluster} collapsed={!clusterOpen} onToggle={() => toggle(cluster.key)} c={c} t={t} />
              {clusterOpen && cluster.nodes.map((group, ni) => {
                const nodeOpen = expanded.includes(group.key)

                return (
                  <Box key={group.key} sx={{ mt: 0.25, ...(ni > 0 && { pt: 0.25, borderTop: `1px solid ${c.borderLight}`, ml: INDENT.node }) }}>
                    <Box sx={ni > 0 ? { ml: -INDENT.node } : undefined}>
                      <NodeRow group={group} collapsed={!nodeOpen} onToggle={() => toggle(group.key)} isDark={isDark} c={c} />
                      {nodeOpen && group.guests.map(vm => <GuestRow key={vm.id} vm={vm} onOpen={openGuest} c={c} />)}
                    </Box>
                  </Box>
                )
              })}
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

export default React.memo(NodeGuestsWidget)
