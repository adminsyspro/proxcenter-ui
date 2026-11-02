'use client'

import { useCallback, useMemo, useState, type ComponentType } from 'react'
import Link from 'next/link'

import { Alert, AlertTitle, Box, Button, Skeleton, Tab, Tabs, Typography, useMediaQuery } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useTranslations } from 'next-intl'

import { CephOsdFlagsDialog, useCephOsdFlags, type CephOsdFlagsState } from '@/components/ceph/CephOsdFlags'
import type { HealthTarget } from '@/lib/ceph/cephHealthLinks'
import { liveFingerprint } from '@/lib/ceph/live'
import { withMonDisk, withoutMonDisk } from '@/lib/ceph/monDisk'
import { cephRatios } from '@/lib/ceph/thresholds'
import type { CephInventory, CephRange, CockpitTab } from '@/lib/ceph/types'

import CephHeader, { type HeaderCluster } from './CephHeader'
import HealthRail from './HealthRail'
import OsdTab from './OsdTab'
import PoolsTab from './PoolsTab'
import OverviewTab from './OverviewTab'
import PerformanceTab from './PerformanceTab'
import CrushTab from './CrushTab'
import ServicesTab from './ServicesTab'
import { useCephInventory } from './hooks/useCephInventory'
import { useCephLive } from './hooks/useCephLive'
import { useRefreshCephHistory } from './hooks/useCephHistory'
import { useClusterHealthList, useRefreshClusterHealthList } from './hooks/useClusterHealthList'
import { useOsdLatencySessionBuffer } from './hooks/useOsdLatencySessionBuffer'
import { useOsdIoStore, type OsdIoStore } from './hooks/useOsdIoColumns'
import type { OsdLatencySeries } from './hooks/useCephOsdLatencySeries'
import { useCockpitLicense } from './hooks/useCockpitLicense'
import { useCockpitUrlState, type CockpitUrlState } from './hooks/useCockpitUrlState'
import { fillColumnLg, formatAge, healthDot, softColor, useNow } from './ui'

/*
   Shell of the Ceph cockpit: header, health rail on the left (300 px, folded
   above the content under 1200 px), six tabs and the active tab's panel. Every
   tab panel receives the same props (CockpitTabProps); a view is plugged in by
   its entry of TAB_PANELS.
*/

export interface CockpitConnection {
  id: string
  name: string
}

/** A health link that points at the host map of the overview (flags): `nonce` tells two clicks apart. */
export interface CockpitFocus {
  kind: 'flags'
  nonce: number
}

export interface CockpitTabProps {
  conn: string
  live: ReturnType<typeof useCephLive>
  inventory: ReturnType<typeof useCephInventory>
  url: CockpitUrlState
  enterprise: boolean
  ratios: { nearfull: number; full: number }
  focus: CockpitFocus | null
  osdFlags: CephOsdFlagsState
  /** Session latency points per OSD (Community curves), filled whichever tab is open. */
  latencyBuffer: OsdLatencySeries
  /** Session state of the IOPS and throughput columns of the OSD tab: kept here so the curves survive a change of tab. */
  ioStore?: OsdIoStore
  onNavigate: (target: HealthTarget) => void
}

/** The views: one component per tab. */
export const TAB_PANELS: Record<CockpitTab, ComponentType<CockpitTabProps>> = {
  overview: OverviewTab,
  osd: OsdTab,
  pools: PoolsTab,
  crush: CrushTab,
  services: ServicesTab,
  perf: PerformanceTab,
}

const TABS: { id: CockpitTab; icon: string }[] = [
  { id: 'overview', icon: 'ri-dashboard-3-line' },
  { id: 'osd', icon: 'ri-hard-drive-2-line' },
  { id: 'pools', icon: 'ri-database-2-line' },
  { id: 'crush', icon: 'ri-node-tree' },
  { id: 'services', icon: 'ri-settings-4-line' },
  { id: 'perf', icon: 'ri-line-chart-line' },
]

const ALL_RANGES: CephRange[] = ['live', '1h', '24h', '7d', '30d']
const RAIL_WIDTH = 300
/** Wide: the rail never gets shorter than its state, about three checks and its foot, even beside a short tab on a low window. */
const RAIL_MIN_HEIGHT = 360

/** Grey out figures that are no longer fresh, without hiding them. */
const STALE_SX = { opacity: 0.55, filter: 'grayscale(0.6)', transition: 'opacity 200ms, filter 200ms' } as const

function EmptyState({ cluster = false }: { cluster?: boolean }) {
  const t = useTranslations('cephCockpit')

  const ring = (icon: string, pos: Record<string, number>) => (
    <Box
      sx={{
        position: 'absolute', ...pos, width: 36, height: 36, borderRadius: '50%', bgcolor: 'background.paper',
        border: '2px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.disabled',
      }}
    >
      <i className={icon} style={{ fontSize: 17 }} aria-hidden />
    </Box>
  )

  return (
    <Box data-testid='cockpit-empty' sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: cluster ? 360 : '60vh', textAlign: 'center', px: 2 }}>
      <Box sx={{ position: 'relative', width: 112, height: 112, mb: 3 }}>
        <Box
          sx={{
            position: 'absolute', inset: 16, borderRadius: '50%', bgcolor: 'action.hover',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.disabled',
          }}
        >
          <i className='ri-stack-line' style={{ fontSize: 34 }} aria-hidden />
        </Box>
        {ring('ri-hard-drive-2-line', { top: 0, right: 4 })}
        {ring('ri-speed-line', { bottom: 2, left: 2 })}
      </Box>
      <Typography variant='h6' fontWeight={700} sx={{ mb: 0.5 }}>
        {cluster ? t('empty.clusterTitle') : t('empty.title')}
      </Typography>
      <Typography variant='body2' color='text.secondary' sx={{ maxWidth: 440, mb: 3 }}>
        {cluster ? t('empty.clusterDescription') : t('empty.description')}
      </Typography>
      {!cluster && (
        <>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', columnGap: 3, rowGap: 1, mb: 3.5, color: 'text.secondary' }}>
            {[
              { icon: 'ri-pie-chart-line', label: t('empty.hintOsds') },
              { icon: 'ri-line-chart-line', label: t('empty.hintLive') },
              { icon: 'ri-heart-pulse-line', label: t('empty.hintHealth') },
            ].map(f => (
              <Box key={f.icon} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <i className={f.icon} style={{ fontSize: 16 }} aria-hidden />
                <Typography variant='caption'>{f.label}</Typography>
              </Box>
            ))}
          </Box>
          <Button variant='outlined' size='small' component={Link} href='/storage/overview'>
            {t('empty.storages')}
          </Button>
        </>
      )}
    </Box>
  )
}

function StaleBanner({ since }: { since: number | null }) {
  const t = useTranslations('cephCockpit')
  const now = useNow()

  return (
    <Alert severity='warning' icon={<i className='ri-wifi-off-line' />} data-testid='cockpit-stale' sx={{ mb: 2 }}>
      <AlertTitle sx={{ mb: 0 }}>{t('stale.title')}</AlertTitle>
      {since !== null && t('stale.body', { age: formatAge(t, now - since) })}
    </Alert>
  )
}

function BodySkeleton({ narrow }: { narrow: boolean }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : `${RAIL_WIDTH}px minmax(0, 1fr)`, gap: 2 }} aria-busy='true'>
      <Skeleton variant='rounded' height={narrow ? 96 : 320} />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Skeleton variant='rounded' height={44} />
        <Skeleton variant='rounded' height={72} />
        <Skeleton variant='rounded' height={240} />
      </Box>
    </Box>
  )
}

function tabCount(tab: CockpitTab, inventory: CephInventory | null, osdDown: number): { value: number; tone: 'error' | 'neutral' } | null {
  if (tab === 'osd') return osdDown > 0 ? { value: osdDown, tone: 'error' } : null
  if (!inventory) return null
  if (tab === 'pools') return inventory.pools.total > 0 ? { value: inventory.pools.total, tone: 'neutral' } : null
  if (tab === 'services') {
    const managers = (inventory.managers.active ? 1 : 0) + inventory.managers.standbys.length + (inventory.managers.stopped?.length ?? 0)
    const total = inventory.monitors.total + managers + inventory.mds.total

    return total > 0 ? { value: total, tone: 'neutral' } : null
  }

  return null
}

/** Container of the tab bar: the icon rule below measures the bar itself, so an open side menu counts. */
export const TABBAR_CONTAINER = 'ceph-tabbar'
/** Below this bar width (tabs + controls on one line), the six tabs only fit without their icons (measured: 544 px of tabs with icons, ~510 px of controls; longer labels in other languages). */
export const TAB_ICONS_MIN_BAR_PX = 1180
/** On one line (lg up), the tab icons go when the bar is too narrow for them: no scrolling of the six tabs. */
export const TAB_ICONS_WHEN_NARROW = {
  [`@container ${TABBAR_CONTAINER} (max-width: ${TAB_ICONS_MIN_BAR_PX - 0.02}px)`]: { '& .MuiTab-iconWrapper': { display: 'none' } },
} as const

export default function CephCockpit({ connections }: { connections: CockpitConnection[] }) {
  const t = useTranslations('cephCockpit')
  const theme = useTheme()
  const narrow = useMediaQuery(theme.breakpoints.down('lg'))
  const url = useCockpitUrlState()
  const { enterprise, resolved: licenseResolved } = useCockpitLicense()

  const ids = useMemo(() => connections.map(c => c.id), [connections])
  const healthList = useClusterHealthList(ids)
  const refreshHealthList = useRefreshClusterHealthList()
  const refreshHistory = useRefreshCephHistory()
  const visible = useMemo(() => connections.filter(c => !healthList[c.id]?.absent), [connections, healthList])
  const conn = visible.some(c => c.id === url.conn) ? url.conn : (visible[0]?.id ?? null)

  const liveRead = useCephLive(conn, true)
  // The inventory reloads on the structure of the Live read, without the MON_DISK_* checks: Ceph cites one monitor at a time there,
  // so they change on every poll. The cockpit shows them rebuilt from the free space of every monitor (inventory.monDisk).
  const inventory = useCephInventory(conn, liveRead.live ? liveFingerprint(withoutMonDisk(liveRead.live)) : null)
  const monDisk = inventory.inventory?.monDisk
  const live = useMemo(
    () => ({ ...liveRead, live: liveRead.live ? withMonDisk(liveRead.live, monDisk) : null }),
    [liveRead, monDisk],
  )
  const ioStore = useOsdIoStore()
  const latencyBuffer = useOsdLatencySessionBuffer(conn, inventory.inventory, inventory.lastOkAt, licenseResolved && !enterprise)
  const hasData = live.live !== null || inventory.inventory !== null
  const osdFlags = useCephOsdFlags(conn, hasData)
  const [flagsOpen, setFlagsOpen] = useState(false)
  const [focus, setFocus] = useState<CockpitFocus | null>(null)

  const { set } = url
  const navigate = useCallback((target: HealthTarget) => {
    set({ tab: target.tab, filter: target.filter, item: target.item ?? null })
    if (target.focus) {
      const kind = target.focus

      setFocus(prev => ({ kind, nonce: (prev?.nonce ?? 0) + 1 }))
    }
  }, [set])

  if (visible.length === 0) return <EmptyState />

  const health = live.live?.health ?? inventory.inventory?.health ?? null
  const clusters: HeaderCluster[] = visible.map(c => ({
    id: c.id,
    name: c.name,
    // The selected cluster follows the Live read, the others keep their reading from the opening.
    state: healthDot(c.id === conn && live.live ? live.live.health.status : healthList[c.id]?.status),
  }))
  // Only a failing Live read means the cluster is unreachable: banner and greyed figures.
  // An inventory that alone fails to refresh is a quiet note in the header.
  const stale = live.error !== null && hasData
  const inventoryStaleSince = !stale && inventory.stale ? inventory.lastOkAt : null
  const lastOkAt = live.lastOkAt ?? inventory.lastOkAt
  const failed = !hasData && (live.error !== null || inventory.error !== null)
  // A 404 on either read means the cluster runs no Ceph (hasCeph:false); data already shown wins.
  const absent = (live.absent || inventory.absent) && !hasData
  const ratios = cephRatios()
  const osdDown = live.live ? Math.max(0, live.live.osd.total - live.live.osd.up) : (inventory.inventory?.osds.down ?? 0)
  const Panel = TAB_PANELS[url.tab]
  const refresh = () => {
    live.refresh()
    inventory.reload()
    refreshHealthList()
    refreshHistory()
  }

  const header = (
    <CephHeader
      clusters={clusters}
      conn={conn}
      onConn={id => set({ conn: id })}
      lastOkAt={lastOkAt}
      range={enterprise ? url.range : 'live'}
      ranges={enterprise ? ALL_RANGES : ['live']}
      onRange={range => set({ range })}
      liveState={live.live && !live.stale ? 'ok' : 'muted'}
      inventoryStaleSince={inventoryStaleSince}
      onRefresh={refresh}
    />
  )

  let body
  const showsTabs = !absent && !failed && hasData && !!conn

  if (absent) {
    body = <EmptyState cluster />
  } else if (failed) {
    body = (
      <Alert
        severity='error'
        data-testid='cockpit-error'
        action={<Button color='inherit' size='small' onClick={refresh}>{t('error.retry')}</Button>}
      >
        {t('error.title')}
      </Alert>
    )
  } else if (!hasData || !conn) {
    body = <BodySkeleton narrow={narrow} />
  } else {
    body = (
      <>
        {stale && <StaleBanner since={lastOkAt} />}
        <Box
          data-testid='cockpit-body'
          data-stale={stale ? 'true' : 'false'}
          sx={{ display: 'grid', gridTemplateColumns: narrow ? 'minmax(0, 1fr)' : `${RAIL_WIDTH}px minmax(0, 1fr)`, gap: 2, alignItems: narrow ? 'start' : 'stretch', ...(!narrow && { flex: '1 1 auto', minHeight: 0 }) }}
        >
          {/* Wide: the rail adds no height of its own (absolute), it takes the row's height and scrolls inside when its checks overflow. */}
          <Box data-testid='rail-slot' sx={{ ...(narrow ? {} : { position: 'relative', minHeight: RAIL_MIN_HEIGHT }), ...(stale && STALE_SX) }}>
            <Box data-testid='rail-fill' sx={narrow ? undefined : { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
            <HealthRail
              fill={!narrow}
              health={health}
              flags={osdFlags}
              onNavigate={navigate}
              onEditFlags={() => setFlagsOpen(true)}
              collapsible={narrow}
              flagsPulse={focus?.kind === 'flags' ? focus.nonce : undefined}
            />
            </Box>
          </Box>

          <Box data-testid='cockpit-main' sx={[{ minWidth: 0 }, fillColumnLg]}>
            {/* Tabs on the left, the controls (cluster picker last) at the right end of the same line; below lg the controls wrap under the tabs. */}
            <Box data-testid='cockpit-tabbar' sx={{ containerType: 'inline-size', containerName: TABBAR_CONTAINER, borderBottom: 1, borderColor: 'divider', mb: 2, flex: 'none', display: 'flex', flexWrap: { xs: 'wrap', lg: 'nowrap' }, alignItems: 'center', columnGap: 2, rowGap: 1, pb: { xs: 1, lg: 0 } }}>
              <Tabs
                value={url.tab}
                onChange={(_e, tab: CockpitTab) => {
                  // A tab picked by hand forgets the last health link: coming back to the overview does not scroll again.
                  setFocus(null)
                  set({ tab, item: null, filter: undefined })
                }}
                variant='scrollable'
                allowScrollButtonsMobile
                sx={{ flex: '1 1 auto', minWidth: { xs: '100%', lg: 0 }, minHeight: 42, '& .MuiTab-iconWrapper': { mr: '6px !important' }, [theme.breakpoints.up('lg')]: TAB_ICONS_WHEN_NARROW, '& .MuiTab-root': { minHeight: 42, minWidth: 0, py: 1, px: 1.25, textTransform: 'none', fontWeight: 600 } }}
              >
                {TABS.map(({ id, icon }) => {
                  const count = tabCount(id, inventory.inventory, osdDown)

                  return (
                    <Tab
                      key={id}
                      value={id}
                      iconPosition='start'
                      icon={<i className={icon} style={{ fontSize: 17 }} aria-hidden />}
                      label={(
                        <Box component='span' sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                          {t(`tabs.${id}`)}
                          {count && (
                            <Box
                              component='span'
                              data-testid={`tab-count-${id}`}
                              sx={{
                                fontSize: 11,
                                fontWeight: 600,
                                fontVariantNumeric: 'tabular-nums',
                                lineHeight: 1.6,
                                px: 0.875,
                                borderRadius: 2.5,
                                bgcolor: count.tone === 'error' ? softColor(theme, 'error', 0.12) : 'action.selected',
                                color: count.tone === 'error' ? 'error.main' : 'text.secondary',
                              }}
                            >
                              {count.value}
                            </Box>
                          )}
                        </Box>
                      )}
                    />
                  )
                })}
              </Tabs>
              {header}
            </Box>

            <Box data-testid='cockpit-panel' sx={[fillColumnLg, stale ? STALE_SX : {}]}>
              <Panel
                conn={conn}
                live={live}
                inventory={inventory}
                url={url}
                enterprise={enterprise}
                ratios={ratios}
                focus={focus}
                osdFlags={osdFlags}
                latencyBuffer={latencyBuffer}
                ioStore={ioStore}
                onNavigate={navigate}
              />
            </Box>
          </Box>
        </Box>
      </>
    )
  }

  return (
    <Box data-testid='cockpit-root' sx={[{ minWidth: 0 }, fillColumnLg, { [theme.breakpoints.up('lg')]: { flexGrow: 1, flexShrink: 0 } }]}>
      {!showsTabs && <Box sx={{ mb: 1 }}>{header}</Box>}
      {body}
      <CephOsdFlagsDialog
        open={flagsOpen}
        onClose={() => setFlagsOpen(false)}
        flags={osdFlags.flags}
        loading={osdFlags.loading}
        toggling={osdFlags.toggling}
        onToggle={osdFlags.toggle}
        hostFlags={osdFlags.hostFlags}
        osdFlags={osdFlags.osdFlags}
        onToggleHost={osdFlags.toggleHost}
      />
    </Box>
  )
}
