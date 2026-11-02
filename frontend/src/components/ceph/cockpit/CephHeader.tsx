'use client'

import { Box, FormControl, IconButton, MenuItem, Select, ToggleButton, ToggleButtonGroup, Tooltip, Typography, useTheme } from '@mui/material'
import { useTranslations } from 'next-intl'

import { NodeGlyph } from '@/components/ui/glyphs'
import type { CephRange } from '@/lib/ceph/types'

import { StateDot, formatAge, useNow, type DotState } from './ui'

/*
   Header of the cockpit, above every tab: the cluster picker with the health
   dot of each cluster, the age of the last good read, the period and refresh.
   The page title (icon + "Ceph") is the app bar's, set by the page.
*/

export interface HeaderCluster {
  id: string
  name: string
  state: DotState
}

export interface CephHeaderProps {
  clusters: HeaderCluster[]
  conn: string | null
  onConn: (id: string) => void
  lastOkAt: number | null
  range: CephRange
  /** Periods on offer: all of them in Enterprise, Live only in Community. */
  ranges: CephRange[]
  onRange: (range: CephRange) => void
  /** Dot inside the Live button: fresh reads (ok) or not (muted). */
  liveState: DotState
  /** Last good inventory read when only the inventory fails to refresh (the Live is fine). */
  inventoryStaleSince?: number | null
  onRefresh: () => void
}

/*
   The controls sit on the tab bar's line, at its right end (the cockpit places
   them), or alone on a thin right-aligned line when there are no tabs yet.
   Updated age, period and refresh come first, the cluster picker is the last.
*/
/* One height and one border for the three controls of the line (period, refresh, cluster). */
export const CONTROL_HEIGHT = 32
const CONTROL_BORDER_RADIUS = 1

/** Colour of the health pip: same palette as the node glyph of the product. */
const PIP_STATUS: Record<DotState, string> = { ok: 'online', warn: 'maintenance', error: 'offline', muted: 'unknown' }

/** Cluster glyph: the Proxmox logo with the Ceph health pip at its bottom right (the product's NodeGlyph, 17 px). */
function ClusterGlyph({ state }: { state: DotState }) {
  const theme = useTheme()

  return <NodeGlyph status={PIP_STATUS[state]} dark={theme.palette.mode === 'dark'} dotBorder={theme.palette.background.paper} size={17} testId='cluster-glyph' />
}

export const TOGGLE_SX = {
  px: 1.25,
  py: 0,
  height: CONTROL_HEIGHT,
  boxSizing: 'border-box',
  gap: 0.75,
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1.5,
  textTransform: 'none',
  color: 'text.secondary',
  '&.Mui-selected, &.Mui-selected:hover': { bgcolor: 'text.primary', color: 'background.paper' },
} as const

export default function CephHeader({ clusters, conn, onConn, lastOkAt, range, ranges, onRange, liveState, inventoryStaleSince = null, onRefresh }: CephHeaderProps) {
  const t = useTranslations('cephCockpit')
  const byId = new Map(clusters.map(c => [c.id, c]))

  return (
    <Box
      data-testid='cockpit-header'
      sx={{
        display: 'flex',
        alignItems: 'center',
        // Wrapping is allowed below lg only: from lg the controls stay on one line.
        flexWrap: { xs: 'wrap', lg: 'nowrap' },
        columnGap: 1.5,
        rowGap: 1,
        justifyContent: 'flex-end',
        flex: '0 1 auto',
        ml: 'auto',
        minWidth: 0,
      }}
    >
      {inventoryStaleSince !== null && <InventoryStaleLabel since={inventoryStaleSince} />}

      {lastOkAt !== null && (
        <Typography variant='body2' color='text.secondary' data-testid='updated-label' sx={{ lineHeight: `${CONTROL_HEIGHT}px`, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', flex: '0 100 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <UpdatedLabel since={lastOkAt} />
        </Typography>
      )}

      <ToggleButtonGroup
        size='small'
        exclusive
        value={range}
        onChange={(_e, next: CephRange | null) => { if (next) onRange(next) }}
        aria-label={t('header.range')}
        sx={{ flex: 'none', bgcolor: 'background.paper', height: CONTROL_HEIGHT, borderRadius: CONTROL_BORDER_RADIUS, '& .MuiToggleButtonGroup-grouped': { borderColor: 'divider' } }}
      >
        {ranges.map(r => (
          <ToggleButton key={r} value={r} sx={TOGGLE_SX}>
            {r === 'live' && <StateDot state={liveState} size={6} />}
            {t(`range.${r}`)}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      <Tooltip title={<>{t('header.refresh')}{lastOkAt !== null && <><br /><UpdatedLabel since={lastOkAt} /></>}</>}>
        <IconButton
          size='small'
          aria-label={t('header.refresh')}
          onClick={onRefresh}
          sx={{ border: '1px solid', borderColor: 'divider', borderRadius: CONTROL_BORDER_RADIUS, bgcolor: 'background.paper', width: CONTROL_HEIGHT, height: CONTROL_HEIGHT, boxSizing: 'border-box', p: 0, flex: 'none' }}
        >
          <i className='ri-refresh-line' style={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>

      <FormControl size='small' sx={{ minWidth: 150, maxWidth: 220, flex: '0 1 auto', height: CONTROL_HEIGHT }}>
        <Select
          value={conn && byId.has(conn) ? conn : ''}
          onChange={e => onConn(String(e.target.value))}
          displayEmpty
          sx={{
            fontWeight: 600,
            bgcolor: 'background.paper',
            height: CONTROL_HEIGHT,
            borderRadius: CONTROL_BORDER_RADIUS,
            '& .MuiSelect-select': { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', boxSizing: 'border-box', height: `${CONTROL_HEIGHT}px !important`, minHeight: 'unset !important', py: 0 },
            '& .MuiOutlinedInput-notchedOutline': { borderColor: 'divider' },
          }}
          SelectDisplayProps={{ 'aria-label': t('header.cluster') }}
          renderValue={value => {
            const c = byId.get(String(value))

            return c ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                <ClusterGlyph state={c.state} />
                <span title={c.name} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
              </Box>
            ) : null
          }}
        >
          {clusters.map(c => (
            <MenuItem key={c.id} value={c.id}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <ClusterGlyph state={c.state} />
                {c.name}
              </Box>
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </Box>
  )
}

/** "Updated 4 s ago", ticking every second in its own component. */
function UpdatedLabel({ since }: { since: number }) {
  const t = useTranslations('cephCockpit')
  const now = useNow()

  return <>{t('header.updated', { age: formatAge(t, now - since) })}</>
}

/** Quiet note: the Live is fine, only the inventory (map, pools, latencies) has not refreshed. */
function InventoryStaleLabel({ since }: { since: number }) {
  const t = useTranslations('cephCockpit')
  const now = useNow()

  return (
    <Typography
      variant='body2'
      data-testid='inventory-stale'
      sx={theme => ({
        display: 'inline-flex', alignItems: 'center', gap: 0.5, color: 'warning.dark', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
        ...theme.applyStyles('dark', { color: 'warning.light' }),
      })}
    >
      <i className='ri-error-warning-line' aria-hidden style={{ fontSize: 15 }} />
      {t('stale.inventory', { age: formatAge(t, now - since) })}
    </Typography>
  )
}
