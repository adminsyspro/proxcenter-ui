'use client'

import { useMemo, useState } from 'react'

import { Box, Card, IconButton, Skeleton, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import { poolFillRatio } from '@/lib/ceph/overview'

import type { CockpitTabProps } from './CephCockpit'
import { useCephPoolStorages } from './hooks/useCephPoolStorages'
import PoolDrawer from './PoolDrawer'
import { poolAvailReported, type StorageReadState, poolDotState, poolObjectsReported, poolRuleName, RuleLink, type Pool } from './PoolParts'
import { fillColumnLg, fillGrowLg, StateDot, TABULAR, ThresholdBar, usePercent } from './ui'

/*
   Pools tab of the Ceph cockpit, read only: one row per pool (application, PVE storage,
   protection, CRUSH rule, PG and autoscale, net fill with its thresholds, used, net
   available, objects), 20 rows per page. A click opens the pool sheet in a drawer and
   writes `item=pool:<name>` in the URL. The rule is a link to the CRUSH tab.
*/

export const POOL_PAGE_SIZE = 20
const COLUMNS = 10
const COLUMN_IDS = ['pool', 'usage', 'protection', 'rule', 'pg', 'fill', 'used', 'avail', 'objects'] as const

function PoolRow({ pool, fill, ratios, rule, storages, storageState, selected, onOpen, onRule }: {
  pool: Pool
  fill: number
  ratios: { nearfull: number; full: number }
  rule: string
  storages: string[]
  storageState: StorageReadState
  selected: boolean
  onOpen: (name: string) => void
  onRule: () => void
}) {
  const t = useTranslations('cephCockpit')
  const format = useFormatter()
  const percent = usePercent()
  const state = poolDotState(fill, ratios)
  const color = state === 'error' ? 'error.main' : state === 'warn' ? 'warning.main' : 'text.primary'

  return (
    <TableRow
      hover
      selected={selected}
      tabIndex={0}
      aria-label={t('pools.open', { name: pool.name })}
      aria-current={selected ? 'true' : undefined}
      data-testid='pool-row'
      data-pool={pool.name}
      data-state={state}
      onClick={() => onOpen(pool.name)}
      onKeyDown={e => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onOpen(pool.name)
        }
      }}
      sx={{ cursor: 'pointer', '& td': { py: 0.875, whiteSpace: 'nowrap' } }}
    >
      <TableCell>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className='ri-database-2-line' style={{ fontSize: 16, opacity: 0.6 }} aria-hidden />
          <StateDot state={state} size={7} />
          <Typography component='span' sx={{ fontSize: 13, fontWeight: 700 }}>{pool.name}</Typography>
        </Box>
      </TableCell>
      <TableCell data-testid='pool-storage' sx={{ fontSize: 12.5 }}>
        <Box component='span' sx={{ display: 'inline-flex', fontSize: 10.5, fontWeight: 600, lineHeight: 1.7, px: 0.75, mr: 0.75, borderRadius: 1, bgcolor: 'action.hover', color: 'text.secondary' }}>
          {pool.application}
        </Box>
        {storages.length > 0 ? storages.join(t('ui.listSeparator')) : storageState === 'loading' ? (
          <Skeleton data-testid='pool-storage-loading' variant='text' width={60} sx={{ display: 'inline-block' }} />
        ) : (
          <Box component='span' title={storageState === 'error' ? t('pools.storageUnavailable') : undefined} sx={{ color: 'text.disabled' }}>{t('overview.missing')}</Box>
        )}
      </TableCell>
      <TableCell sx={{ ...TABULAR, fontSize: 12.5 }}>{t('pools.protection', { size: pool.size, min: pool.minSize })}</TableCell>
      <TableCell><RuleLink name={rule} onOpen={onRule} /></TableCell>
      <TableCell sx={{ ...TABULAR, fontSize: 12.5 }}>
        {format.number(pool.pgNum)}
        <Box component='span' sx={{ color: 'text.secondary' }}>{t('ui.separator')}{t('pools.autoscale', { mode: pool.pgAutoscaleMode })}</Box>
      </TableCell>
      <TableCell sx={{ minWidth: 160 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: '110px 44px', alignItems: 'center', columnGap: 1 }}>
          <ThresholdBar value={fill} max={1} nearfull={ratios.nearfull} full={ratios.full} size='sm' />
          <Typography component='span' sx={{ ...TABULAR, fontSize: 12.5, fontWeight: 700, textAlign: 'right', color }}>{percent(fill, fill > 0 && fill < 0.01 ? 1 : 0)}</Typography>
        </Box>
      </TableCell>
      <TableCell sx={{ ...TABULAR, fontSize: 12.5 }}>{pool.bytesUsedFormatted}</TableCell>
      <TableCell sx={{ ...TABULAR, fontSize: 12.5 }}>{poolAvailReported(pool, fill) ? pool.maxAvailFormatted : t('overview.missing')}</TableCell>
      <TableCell sx={{ ...TABULAR, fontSize: 12.5 }}>{poolObjectsReported(pool) ? format.number(pool.objects) : t('overview.missing')}</TableCell>
      <TableCell align='right' sx={{ width: 32 }}><i className='ri-arrow-right-s-line' style={{ opacity: 0.45 }} aria-hidden /></TableCell>
    </TableRow>
  )
}

export default function PoolsTab({ conn, inventory, url, ratios, onNavigate }: CockpitTabProps) {
  const t = useTranslations('cephCockpit')
  const inv = inventory.inventory
  const { storages, loading: storagesLoading, error: storagesError } = useCephPoolStorages(conn)
  const storageState: StorageReadState = storages ? 'ready' : storagesError ? 'error' : storagesLoading ? 'loading' : 'ready'
  const [page, setPage] = useState(0)
  const [followed, setFollowed] = useState<string | null>(null)

  const sorted = useMemo(
    () => (inv?.pools.list ?? []).map(p => ({ pool: p, fill: poolFillRatio(p.percentUsed) })).sort((a, b) => b.fill - a.fill || a.pool.name.localeCompare(b.pool.name)),
    [inv],
  )

  const selectedName = url.item?.kind === 'pool' ? url.item.name : null
  const at = sorted.findIndex(e => e.pool.name === selectedName)
  const selected = at >= 0 ? sorted[at] : null

  // The page follows the pool the sheet moves to (arrows, overview link, deep link), not the other way round.
  if (selectedName !== followed) {
    setFollowed(selectedName)
    if (at >= 0) setPage(Math.floor(at / POOL_PAGE_SIZE))
  }

  if (!inv) return <Skeleton variant='rounded' height={240} data-testid='pools-loading' />

  const pageCount = Math.max(1, Math.ceil(sorted.length / POOL_PAGE_SIZE))
  const current = Math.min(page, pageCount - 1)
  const shown = sorted.slice(current * POOL_PAGE_SIZE, (current + 1) * POOL_PAGE_SIZE)
  const open = (name: string) => url.set({ item: { kind: 'pool', name } })
  const step = (delta: number) => {
    const target = sorted[at + delta]

    if (target) open(target.pool.name)
  }

  return (
    <Box data-testid='pools-tab' sx={fillColumnLg}>
      <Card variant='outlined' data-testid='pools-card' sx={fillColumnLg}>
        <Box data-testid='pools-table' sx={[{ overflowX: 'auto' }, fillGrowLg]}>
          <Table size='small' sx={{ minWidth: 900, '& th, & td': { px: 1.25 } }}>
            <TableHead>
              <TableRow sx={{ '& th': { fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'text.secondary', whiteSpace: 'nowrap' } }}>
                {COLUMN_IDS.map(c => <TableCell key={c}>{t(`pools.columns.${c}`)}</TableCell>)}
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.length === 0 && (
                <TableRow>
                  <TableCell colSpan={COLUMNS} sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>{t('pools.empty')}</TableCell>
                </TableRow>
              )}
              {shown.map(({ pool, fill }) => (
                <PoolRow
                  key={pool.name}
                  pool={pool}
                  fill={fill}
                  ratios={ratios}
                  rule={poolRuleName(pool, inv.crushRules)}
                  storages={storages?.[pool.name] ?? []}
                  storageState={storageState}
                  selected={pool.name === selectedName}
                  onOpen={open}
                  onRule={() => onNavigate({ tab: 'crush' })}
                />
              ))}
            </TableBody>
          </Table>
        </Box>

        {sorted.length > POOL_PAGE_SIZE && (
          <Box data-testid='pool-pager' sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1, px: 1.5, py: 0.75, borderTop: '1px solid', borderColor: 'divider' }}>
            <Typography variant='caption' color='text.secondary' sx={TABULAR}>
              {t('pools.pager.range', { from: current * POOL_PAGE_SIZE + 1, to: Math.min(sorted.length, (current + 1) * POOL_PAGE_SIZE), total: sorted.length })}
            </Typography>
            <IconButton size='small' aria-label={t('pools.pager.prev')} disabled={current === 0} onClick={() => setPage(current - 1)}><i className='ri-arrow-left-s-line' /></IconButton>
            <IconButton size='small' aria-label={t('pools.pager.next')} disabled={current >= pageCount - 1} onClick={() => setPage(current + 1)}><i className='ri-arrow-right-s-line' /></IconButton>
          </Box>
        )}
      </Card>

      {selected && (
        <PoolDrawer
          pool={selected.pool}
          fill={selected.fill}
          ratios={ratios}
          rule={poolRuleName(selected.pool, inv.crushRules)}
          storages={storages?.[selected.pool.name] ?? []}
          storageState={storageState}
          hasPrev={at > 0}
          hasNext={at < sorted.length - 1}
          onClose={() => url.set({ item: null })}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          onRule={() => onNavigate({ tab: 'crush' })}
        />
      )}
    </Box>
  )
}
