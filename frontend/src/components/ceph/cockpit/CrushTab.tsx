'use client'

import { useMemo, useState } from 'react'

import { Alert, Box, Button, Card, IconButton, MenuItem, Select, Skeleton, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { SMALL_SELECT_SX } from '@/components/settings/destinations/DestinationDialogParts'
import { crushClasses, crushTree, filterCrushTree, flattenCrushNodes, type CrushNode } from '@/lib/ceph/crushTree'
import { hostGroups, osdIssues, type HostGroup } from '@/lib/ceph/hostMap'
import { flagsOnOsd, hostFlagsForNode } from '@/lib/ceph/osdFlagsView'
import { osdDotState } from '@/lib/ceph/osdTable'
import type { CephInventory, CephOsd } from '@/lib/ceph/types'

import type { CockpitTabProps } from './CephCockpit'
import CrushRules, { useDomainLabel } from './CrushRules'
import { useCephCrush } from './hooks/useCephCrush'
import { CephOsdGlyph, fillColumnLg, fillGrowLg, HostGlyph, Tag, TABULAR, ThresholdBar, useStableByKey, usePercent } from './ui'

/*
   CRUSH tab of the Ceph cockpit, read only: the hierarchy of the CRUSH map as a foldable
   tree (fill, OSDs up, classes, daemons and flags at every level, filtered by device
   class, 20 rows per page) next to the rules and what each pool tolerates. A click on an
   OSD opens its sheet in the OSD tab. The map is fetched the first time the tab is shown.
*/

export const CRUSH_PAGE_SIZE = 20
const EMPTY: CephOsd[] = []

const TYPE_ICON: Record<string, string> = {
  root: 'ri-stack-line',
  region: 'ri-earth-line',
  zone: 'ri-map-pin-line',
  datacenter: 'ri-building-2-line',
  room: 'ri-door-open-line',
  row: 'ri-layout-row-line',
  pod: 'ri-archive-drawer-line',
  rack: 'ri-server-line',
  chassis: 'ri-hard-drive-3-line',
  host: 'ri-server-line',
  osd: 'ri-hard-drive-2-line',
}

/** Unfolded by default: every bucket, unless that overflows a page, then the buckets that hold OSDs directly stay folded. */
function defaultUnfolded(tree: CrushNode[]): Set<string> {
  const all = (nodes: CrushNode[]): CrushNode[] => nodes.flatMap(n => [n, ...all(n.children)])
  const buckets = all(tree).filter(n => n.type !== 'osd')
  const full = new Set(buckets.map(n => String(n.id)))

  if (flattenCrushNodes(tree, full).length <= CRUSH_PAGE_SIZE) return full

  return new Set(buckets.filter(n => n.children.some(c => c.type !== 'osd')).map(n => String(n.id)))
}

interface RowContext {
  inventory: CephInventory | null | undefined
  osdById: Map<number, CephOsd>
  hosts: Map<string, HostGroup>
  ratios: { nearfull: number; full: number }
  issues: ReturnType<typeof osdIssues>
  flags: CockpitTabProps['osdFlags']
}

function NodeRow({ node, depth, folded, ctx, onToggle, onOsd }: {
  node: CrushNode
  depth: number
  folded: boolean
  ctx: RowContext
  onToggle: (id: string) => void
  onOsd: (id: number) => void
}) {
  const t = useTranslations('cephCockpit')
  const domain = useDomainLabel()
  const percent = usePercent()
  const isOsd = node.type === 'osd'
  const osd = isOsd ? ctx.osdById.get(node.id) : undefined
  const group = ctx.hosts.get(node.name)
  const flags = isOsd && osd
    ? flagsOnOsd(osd.id, osd.host, ctx.flags.osdFlags, ctx.flags.hostFlags).filter(f => f.scope === 'osd').map(f => f.flag)
    : hostFlagsForNode(ctx.flags.hostFlags, node.name).flags
  const fill = node.fillRatio
  const fillColor = fill >= ctx.ratios.full ? 'error.main' : fill >= ctx.ratios.nearfull ? 'warning.main' : 'text.primary'
  const dot = osd ? osdDotState(osd, ctx.ratios, ctx.issues.get(osd.id) ?? []) : node.flagged ? 'warn' : 'ok'
  const stateLabel = osd ? t(osd.up ? (osd.in ? 'osd.state.up' : 'osd.state.out') : 'osd.state.down') : t('crush.tree.upCount', { up: node.osdUp, total: node.osdTotal })
  const hasKids = node.children.length > 0
  const activate = () => (isOsd ? onOsd(node.id) : hasKids && onToggle(String(node.id)))

  return (
    <Box
      role='treeitem'
      aria-level={depth + 1}
      aria-expanded={isOsd || !hasKids ? undefined : !folded}
      aria-label={isOsd ? t('crush.tree.openOsd', { name: node.name }) : undefined}
      tabIndex={0}
      data-testid={isOsd ? 'crush-osd' : 'crush-bucket'}
      data-node={node.name}
      data-state={dot}
      onClick={activate}
      onKeyDown={e => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          activate()
        }
      }}
      sx={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(64px, 160px) 72px',
        alignItems: 'center',
        columnGap: 1.5,
        py: 0.625,
        pr: 1.5,
        pl: `${12 + depth * 20}px`,
        borderTop: '1px solid',
        borderColor: 'divider',
        cursor: isOsd || hasKids ? 'pointer' : 'default',
        '&:hover': { bgcolor: 'action.hover' },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
        <Box component='span' sx={{ width: 18, flex: 'none', display: 'inline-flex', justifyContent: 'center', opacity: 0.6 }}>
          {hasKids && <i className={folded ? 'ri-arrow-right-s-line' : 'ri-arrow-down-s-line'} aria-hidden />}
        </Box>
        {isOsd ? (
          <CephOsdGlyph osd={osd} />
        ) : node.type === 'host' ? (
          <HostGlyph host={node.name} inventory={ctx.inventory} />
        ) : (
          <i className={TYPE_ICON[node.type] ?? 'ri-folder-line'} style={{ fontSize: 15, opacity: 0.6 }} aria-hidden />
        )}
        <Typography component='span' noWrap title={node.name} sx={{ fontSize: 13, fontWeight: isOsd ? 500 : 700, flex: 'none', maxWidth: '24ch' }}>{node.name}</Typography>
        {!isOsd && (
          <Typography component='span' variant='caption' color='text.secondary' noWrap sx={{ ...TABULAR, flex: '0 1 auto', minWidth: 0 }}>
            {t('crush.tree.meta', { type: domain(node.type, 1), count: node.osdTotal })}
          </Typography>
        )}
        {isOsd && node.classes.map(c => <Tag key={c}>{c}</Tag>)}
        {group?.mon && <Tag tone={group.mon.inQuorum ? 'ok' : 'warning'}>{group.mon.leader ? t('crush.tree.monLeader') : 'mon'}</Tag>}
        {group?.mgr && <Tag>mgr</Tag>}
        {group && group.mds > 0 && <Tag>mds</Tag>}
        {flags.map(f => <Tag key={f} tone='info'>{f}</Tag>)}
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(24px, 100px) 40px', alignItems: 'center', columnGap: 1 }}>
        {node.osdTotal > 0 && (osd ? osd.up : node.osdUp > 0) ? (
          <>
            <ThresholdBar value={fill} max={1} nearfull={ctx.ratios.nearfull} full={ctx.ratios.full} size='sm' />
            <Typography component='span' sx={{ ...TABULAR, fontSize: 12.5, fontWeight: 700, textAlign: 'right', color: fillColor }}>{percent(fill, 0)}</Typography>
          </>
        ) : (
          <Typography component='span' sx={{ gridColumn: '1 / -1', fontSize: 12.5, color: 'text.disabled' }}>{t('overview.missing')}</Typography>
        )}
      </Box>
      <Typography component='span' sx={{ ...TABULAR, fontSize: 12.5, color: node.flagged ? 'warning.main' : 'text.secondary', textAlign: 'right' }}>{stateLabel}</Typography>
    </Box>
  )
}

export default function CrushTab({ conn, live, inventory, url, ratios, osdFlags }: CockpitTabProps) {
  const t = useTranslations('cephCockpit')
  const inv = inventory.inventory
  const { crush, loading, error } = useCephCrush(conn, url.tab === 'crush')
  const osds = inv?.osds.list ?? EMPTY
  const [deviceClass, setDeviceClass] = useState('')
  const [pick, setPick] = useState<Set<string> | null>(null)
  const [page, setPage] = useState(0)

  const checks = live.live?.health.checks ?? inv?.health.checks
  const rawIssues = useMemo(() => osdIssues(checks ?? []), [checks])
  const issues = useStableByKey(rawIssues, [...rawIssues].map(([id, list]) => `${id}:${list.map(i => `${i.code}/${i.severity}`).join(',')}`).join('|'))
  const classes = useMemo(() => crushClasses(osds), [osds])
  const activeClass = classes.includes(deviceClass) ? deviceClass : ''

  const tree = useMemo(() => {
    if (!crush) return []

    const built = crushTree(crush.buckets, activeClass ? osds.filter(o => o.deviceClass === activeClass) : osds)

    return activeClass ? filterCrushTree(built) : built
  }, [crush, osds, activeClass])

  const defaults = useMemo(() => defaultUnfolded(tree), [tree])
  const unfolded = pick ?? defaults
  const rows = useMemo(() => flattenCrushNodes(tree, unfolded), [tree, unfolded])
  const ctx = useMemo<RowContext>(() => ({
    inventory: inv,
    osdById: new Map(osds.map(o => [o.id, o])),
    hosts: new Map(inv ? hostGroups(inv).map(g => [g.name, g]) : []),
    ratios,
    issues,
    flags: osdFlags,
  }), [osds, inv, ratios, issues, osdFlags])

  if (!inv || (!crush && !error)) {
    return <Skeleton variant='rounded' height={240} data-testid='crush-loading' />
  }

  if (!crush) {
    return <Alert severity='error' data-testid='crush-error'>{t('crush.error')}</Alert>
  }

  const buckets = tree.flatMap(function collect(n: CrushNode): CrushNode[] { return n.type === 'osd' ? [] : [n, ...n.children.flatMap(collect)] })
  const foldable = buckets.filter(n => n.children.length > 0).map(n => String(n.id))
  const allOpen = foldable.every(id => unfolded.has(id))
  const pageCount = Math.max(1, Math.ceil(rows.length / CRUSH_PAGE_SIZE))
  const current = Math.min(page, pageCount - 1)
  const shown = rows.slice(current * CRUSH_PAGE_SIZE, (current + 1) * CRUSH_PAGE_SIZE)

  const toggle = (id: string) => {
    const next = new Set(unfolded)

    if (!next.delete(id)) next.add(id)

    setPick(next)
  }

  return (
    <Box data-testid='crush-tab' sx={[{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 3fr) minmax(0, 2fr)' }, gap: 2, alignItems: { xs: 'start', lg: 'stretch' } }, fillGrowLg]}>
      <Card variant='outlined' data-testid='crush-tree-card' sx={fillColumnLg}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', px: 1.5, py: 1.25 }}>
          <i className='ri-node-tree' style={{ fontSize: 16, opacity: 0.6 }} aria-hidden />
          <Typography component='h3' sx={{ fontSize: 14, fontWeight: 700 }}>{t('crush.tree.title')}</Typography>
          <Box sx={{ flex: 1 }} />
          <Select
            size='small'
            displayEmpty
            value={activeClass}
            onChange={e => { setDeviceClass(e.target.value); setPage(0) }}
            inputProps={{ 'aria-label': t('osd.classFilter') }}
            sx={{ minWidth: 150, ...SMALL_SELECT_SX }}
          >
            <MenuItem value=''>{t('osd.allClasses')}</MenuItem>
            {classes.map(c => <MenuItem key={c} value={c}>{c.toUpperCase()}</MenuItem>)}
          </Select>
          {foldable.length > 0 && (
            <Button size='small' onClick={() => { setPick(new Set(allOpen ? [] : foldable)); setPage(0) }}>
              {t(allOpen ? 'crush.tree.foldAll' : 'crush.tree.unfoldAll')}
            </Button>
          )}
        </Box>

        <Box role='tree' aria-label={t('crush.tree.title')} sx={fillGrowLg}>
          {shown.length === 0 && (
            <Typography sx={{ py: 4, textAlign: 'center', color: 'text.secondary', borderTop: '1px solid', borderColor: 'divider' }}>
              {t('crush.tree.empty')}
            </Typography>
          )}
          {shown.map(({ node, depth }) => (
            <NodeRow
              key={`${node.type}-${node.id}`}
              node={node}
              depth={depth}
              folded={!unfolded.has(String(node.id))}
              ctx={ctx}
              onToggle={toggle}
              onOsd={id => url.set({ tab: 'osd', item: { kind: 'osd', id } })}
            />
          ))}
        </Box>

        {rows.length > CRUSH_PAGE_SIZE && (
          <Box data-testid='crush-pager' sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1, px: 1.5, py: 0.75, borderTop: '1px solid', borderColor: 'divider' }}>
            <Typography variant='caption' color='text.secondary' sx={TABULAR}>
              {t('osd.pager.range', { from: current * CRUSH_PAGE_SIZE + 1, to: Math.min(rows.length, (current + 1) * CRUSH_PAGE_SIZE), total: rows.length })}
            </Typography>
            <IconButton size='small' aria-label={t('osd.pager.prev')} disabled={current === 0} onClick={() => setPage(current - 1)}><i className='ri-arrow-left-s-line' /></IconButton>
            <IconButton size='small' aria-label={t('osd.pager.next')} disabled={current >= pageCount - 1} onClick={() => setPage(current + 1)}><i className='ri-arrow-right-s-line' /></IconButton>
          </Box>
        )}
      </Card>

      <Card variant='outlined' data-testid='crush-rules-card'>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1.25 }}>
          <i className='ri-route-line' style={{ fontSize: 16, opacity: 0.6 }} aria-hidden />
          <Typography component='h3' sx={{ fontSize: 14, fontWeight: 700 }}>{t('crush.rules.title')}</Typography>
          <Box sx={{ flex: 1 }} />
          <Typography variant='caption' color='text.secondary'>{t('crush.rules.source')}</Typography>
        </Box>
        <Box sx={{ px: 1.5, pb: 0.5, borderTop: '1px solid', borderColor: 'divider' }}>
          <CrushRules
            rules={crush.rules}
            buckets={crush.buckets}
            pools={inv.pools.list}
            onPool={name => url.set({ tab: 'pools', item: { kind: 'pool', name } })}
          />
        </Box>
      </Card>
    </Box>
  )
}

