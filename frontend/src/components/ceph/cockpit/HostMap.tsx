'use client'

import { memo, useMemo, type ReactNode } from 'react'

import { Box, ButtonBase, FormControlLabel, Switch, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material'
import { useTheme, type Theme } from '@mui/material/styles'
import { useFormatter, useTranslations } from 'next-intl'

import { flagsOnOsd, hostFlagsForNode, type ScopedFlagMap } from '@/lib/ceph/osdFlagsView'
import {
  DENSE_MID_RATIO, DENSE_PROBLEM_FILTER_MIN_HOSTS, denseNameWidth, denseRowMinWidth, fillTone, hostGroups, hostMapMode, hostSummary, osdCell, osdIssues, problemHosts,
  type FillTone, type HostGroup, type OsdIssue, type Ratios,
} from '@/lib/ceph/hostMap'
import { osdDotState } from '@/lib/ceph/osdTable'
import { osdLatencyMs } from '@/lib/ceph/overview'
import type { CephHealthIssue, CephInventory, CephOsd } from '@/lib/ceph/types'

import { TOGGLE_SX } from './CephHeader'
import type { HostMapView } from './hooks/useCockpitUrlState'
import { CephOsdGlyph, fillCardLg, HostGlyph, SectionCard, TABULAR, softColor, usePercent, useStableByKey, type DotState } from './ui'

/*
   Map of the cluster host by host. Up to 4 OSDs per host, one card per host with
   each OSD detailed (fill ring, state, class, latency, PGs). Above, a dense grid:
   one 14 px square per OSD, its colour on the fill scale, a red outline when down,
   dimmed when out, a dot when a flag is set. Hover gives the summary, click opens
   the OSD sheet.
*/

export interface HostMapProps {
  inventory: CephInventory
  ratios: Ratios
  onOpenOsd: (id: number) => void
  hostFlags?: ScopedFlagMap
  osdFlags?: ScopedFlagMap
  /** Health checks: an OSD one of them points at is marked. */
  checks?: CephHealthIssue[]
  /** Link at the right of the section header. */
  action?: ReactNode
  /** Dense map of more than 40 hosts: show only the hosts with a problem (carried by the URL). */
  problemOnly?: boolean
  onProblemOnlyChange?: (on: boolean) => void
  /** Explicit view (compact cards or dense squares); null or absent: the automatic mode. */
  view?: HostMapView | null
  onViewChange?: (view: HostMapView) => void
}

type Translate = ReturnType<typeof useTranslations<'cephCockpit'>>
type Palette = Theme['palette'] & { text: Theme['palette']['text'] & { secondaryChannel?: string } }

const EMPTY_FLAGS: ScopedFlagMap = {}
const EMPTY_CHECKS: CephHealthIssue[] = []
const NO_FLAGS: string[] = []
const NO_ISSUES: OsdIssue[] = []
const CELL = 14

/** Palette as CSS variables when the app theme provides them, so the dark scheme follows. */
const paletteOf = (theme: Theme) => (theme.vars?.palette ?? theme.palette) as Palette

/** Past nearfull the state is not carried by the hue alone (a brand colour can sit close to warning or error): a pattern too. */
const isAlert = (tone: FillTone) => tone === 'nearfull' || tone === 'full'

/**
 * Fine diagonal hatching in `stripe`: one direction at nearfull, crossed at full, so the two alert levels also
 * differ without the hue. Layers of a `background`, to be followed by the base colour or gradient.
 */
function hatching(tone: 'nearfull' | 'full', stripe: string): string[] {
  const line = (angle: number) => `repeating-linear-gradient(${angle}deg, ${stripe} 0, ${stripe} 1px, transparent 1px, transparent 4px)`

  return tone === 'full' ? [line(45), line(-45)] : [line(45)]
}

interface DensePaint {
  backgroundColor: string
  backgroundImage?: string
  boxShadow?: string
}

/** Paint of a dense square or of its legend swatch: soft theme steps below nearfull, then solid + hatching + inner contour. */
function denseFill(theme: Theme, tone: FillTone): DensePaint {
  const p = paletteOf(theme)

  switch (tone) {
    case 'full':
    case 'nearfull': {
      const solid = tone === 'full' ? p.error.main : p.warning.main

      return {
        backgroundColor: solid,
        backgroundImage: hatching(tone, p.background.paper).join(', '),
        boxShadow: `inset 0 0 0 1.5px ${p.text.primary}`,
      }
    }

    case 'mid':
      return { backgroundColor: softColor(theme, 'primary', 0.6) }
    default:
      return { backgroundColor: softColor(theme, 'primary', 0.28) }
  }
}

/** Colour of the fill gauge of a card: the theme colour, then the warning and error states. */
function gaugeKey(tone: FillTone): 'primary' | 'warning' | 'error' {
  return tone === 'full' ? 'error' : tone === 'nearfull' ? 'warning' : 'primary'
}

/**
 * A band from the left edge up to `ratio` of the width (the card as a fill gauge). Theme colour at 0.16 below
 * nearfull; past it the state colour at 0.32 with fine hatching on the filled part.
 */
function fillGauge(theme: Theme, ratio: number, tone: FillTone): { backgroundImage: string; backgroundSize: string; backgroundRepeat: string } {
  const pct = Math.round(Math.min(1, Math.max(0, ratio)) * 1000) / 10
  const key = gaugeKey(tone)
  const tint = softColor(theme, key, isAlert(tone) ? 0.32 : 0.16)
  const band = `linear-gradient(to right, ${tint} 0%, ${tint} ${pct}%, transparent ${pct}%)`

  if (tone !== 'nearfull' && tone !== 'full') return { backgroundImage: band, backgroundSize: '100% 100%', backgroundRepeat: 'no-repeat' }

  // The hatching layers are cut to the filled width; the band covers the whole card.
  const lines = hatching(tone, softColor(theme, key, 0.4))

  return {
    backgroundImage: [...lines, band].join(', '),
    backgroundSize: [...lines.map(() => `${pct}% 100%`), '100% 100%'].join(', '),
    backgroundRepeat: 'no-repeat',
  }
}

function Tag({ children, tone = 'neutral', title }: { children: ReactNode; tone?: 'neutral' | 'ok' | 'info' | 'warning' | 'error'; title?: string }) {
  const theme = useTheme()
  const color = tone === 'neutral' ? 'text.secondary' : tone === 'ok' ? 'success.main' : `${tone}.main`
  const bg = tone === 'neutral' ? 'action.hover' : softColor(theme, tone === 'ok' ? 'success' : tone, 0.12)

  return (
    <Box
      component='span'
      title={title}
      sx={{
        display: 'inline-flex', alignItems: 'center', gap: 0.375, flex: 'none', fontSize: 10.5, fontWeight: 600, lineHeight: 1.7,
        px: 0.75, borderRadius: 1, color, bgcolor: bg, whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Box>
  )
}

/** Monitor, manager, MDS and flags of a host, as small tags. */
function HostTags({ host, flags, t }: { host: HostGroup; flags: string[]; t: Translate }) {
  return (
    <>
      {host.mon && (
        <Tag
          tone={host.mon.inQuorum ? 'ok' : 'error'}
          title={host.mon.inQuorum ? (host.mon.leader ? t('overview.hostMap.monLeader') : undefined) : t('overview.hostMap.monOutOfQuorum')}
        >
          {t('overview.hostMap.mon')}
          {host.mon.leader && <i className='ri-star-fill' style={{ fontSize: 9 }} aria-label={t('overview.hostMap.monLeader')} />}
        </Tag>
      )}
      {host.mgr && <Tag>{host.mgr === 'active' ? t('overview.hostMap.mgrActive') : t('overview.hostMap.mgrStandby')}</Tag>}
      {host.mds > 0 && <Tag>{t('overview.hostMap.mds')}</Tag>}
      {flags.map(f => (
        <Tag key={f} tone='info'>
          <i className='ri-flag-line' style={{ fontSize: 10 }} aria-hidden />
          {f}
        </Tag>
      ))}
    </>
  )
}

/** Fill ring of a card: the theme colour below nearfull, then the warning and error states. */
function FillRing({ ratio, down, ratios }: { ratio: number; down: boolean; ratios: Ratios }) {
  const theme = useTheme()
  const percent = usePercent()
  const p = paletteOf(theme)
  const tone = fillTone(ratio, ratios)
  const stroke = p[gaugeKey(tone)].main
  // Thicker past nearfull: the change reads without the hue.
  const width = isAlert(tone) ? 5 : 4
  const r = 15
  const length = 2 * Math.PI * r

  return (
    <Box sx={{ position: 'relative', width: 40, height: 40, flex: 'none' }} aria-hidden>
      <svg width={40} height={40} viewBox='0 0 40 40' style={{ display: 'block', transform: 'rotate(-90deg)' }}>
        <circle cx={20} cy={20} r={r + 1} fill='none' strokeWidth={width} style={{ stroke: p.divider }} />
        {!down && (
          <circle
            cx={20} cy={20} r={r + 1} fill='none' strokeWidth={width} strokeLinecap='round'
            strokeDasharray={`${length * ratio} ${length}`}
            style={{ stroke }}
          />
        )}
      </svg>
      <Typography
        component='span'
        sx={{ ...TABULAR, position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, letterSpacing: '-0.03em', whiteSpace: 'nowrap', color: down ? 'error.main' : 'text.primary' }}
      >
        {down ? '\u00d7' : percent(ratio)}
      </Typography>
    </Box>
  )
}

/** Latency of an OSD for display: "2 ms", or "- ms" when it was not measured (never "0 ms" for a missing reading). */
function useLatencyLabel() {
  const t = useTranslations('cephCockpit')
  const format = useFormatter()

  return (osd: CephOsd) => {
    const ms = osdLatencyMs(osd)

    return t('overview.hostMap.latency', { ms: ms === null ? t('overview.missing') : format.number(ms, { maximumFractionDigits: 1 }) })
  }
}

function OsdRow({ osd, ratios, ownFlags, issues, onOpen }: {
  osd: CephOsd
  ratios: Ratios
  ownFlags: string[]
  issues: OsdIssue[]
  onOpen: (id: number) => void
}) {
  const t = useTranslations('cephCockpit')
  const theme = useTheme()
  const latency = useLatencyLabel()
  const cell = osdCell(osd)
  const state = osdDotState(osd, ratios, issues)
  const sep = t('ui.separator')

  return (
    <ButtonBase
      onClick={() => onOpen(osd.id)}
      aria-label={t('overview.hostMap.open', { id: osd.id })}
      data-testid='host-osd'
      data-state={state}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.25, width: '100%', justifyContent: 'flex-start', textAlign: 'left',
        px: 1.25, py: 1, borderRadius: 1.25, border: '1px solid',
        borderColor: state === 'error' ? 'error.main' : state === 'warn' ? 'warning.main' : 'divider',
        // The card itself is the fill gauge: tinted from the left up to the fill ratio.
        backgroundColor: state === 'error' ? softColor(theme, 'error', 0.05) : state === 'warn' ? softColor(theme, 'warning', 0.06) : 'transparent',
        ...(cell.down ? { backgroundImage: 'none' } : fillGauge(theme, cell.fillRatio, fillTone(cell.fillRatio, ratios))),
        opacity: cell.out ? 0.6 : 1,
        transition: 'background-color 120ms',
        '&:hover': { backgroundColor: 'action.hover' },
        '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 },
      }}
    >
      <FillRing ratio={cell.fillRatio} down={cell.down} ratios={ratios} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
          <CephOsdGlyph osd={osd} />
          <Typography component='span' sx={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>{osd.name || `osd.${osd.id}`}</Typography>
          {osd.deviceClass && osd.deviceClass !== 'unknown' && <Tag>{osd.deviceClass.toUpperCase()}</Tag>}
          {ownFlags.map(f => <Tag key={f} tone='info'>{f}</Tag>)}
          {issues.slice(0, 1).map(i => <Tag key={i.code} tone={i.severity}>{i.code}</Tag>)}
        </Box>
        <Typography component='div' variant='caption' color='text.secondary' noWrap sx={{ ...TABULAR, display: 'block', mt: 0.25 }}>
          <Box component='span' sx={cell.down ? { color: 'error.main', fontWeight: 600 } : undefined}>
            {cell.down ? t('overview.hostMap.down') : t('overview.hostMap.up')}
          </Box>
          {sep}
          <Box component='span' sx={cell.out ? { color: 'warning.main', fontWeight: 600 } : undefined}>
            {cell.out ? t('overview.hostMap.out') : t('overview.hostMap.in')}
          </Box>
          {!cell.down && <>{sep}{latency(osd)}</>}
          {typeof osd.pgs === 'number' && <>{sep}{t('overview.hostMap.pgs', { count: osd.pgs })}</>}
        </Typography>
      </Box>
    </ButtonBase>
  )
}

function CardsMap({ inventory, hosts, ratios, hostFlags, osdFlags, issues, onOpenOsd }: MapBodyProps) {
  const t = useTranslations('cephCockpit')

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 1.5 }}>
      {hosts.map(host => (
        <Box key={host.name} data-testid='host-card' sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5, p: 1.5, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.75, mb: 1.25 }}>
            <HostGlyph host={host.name} inventory={inventory} />
            <Typography component='span' sx={{ fontSize: 13.5, fontWeight: 700, mr: 0.5 }} noWrap>{host.name}</Typography>
            <HostTags host={host} flags={hostFlagsForNode(hostFlags, host.name).flags} t={t} />
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            {host.osds.map(osd => (
              <OsdRow
                key={osd.id}
                osd={osd}
                ratios={ratios}
                ownFlags={osdFlags[`osd.${osd.id}`] ?? NO_FLAGS}
                issues={issues.get(osd.id) ?? NO_ISSUES}
                onOpen={onOpenOsd}
              />
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  )
}

/** Hover card of a dense cell. */
function CellSummary({ osd, flags, issues }: { osd: CephOsd; flags: string[]; issues: OsdIssue[] }) {
  const t = useTranslations('cephCockpit')
  const percent = usePercent()
  const latency = useLatencyLabel()
  const cell = osdCell(osd, flags)
  const sep = t('ui.separator')

  return (
    <Box sx={{ ...TABULAR, py: 0.25 }}>
      <Box sx={{ fontWeight: 700 }}>
        {osd.name || `osd.${osd.id}`}{sep}{osd.host}{osd.deviceClass && osd.deviceClass !== 'unknown' ? `${sep}${osd.deviceClass.toUpperCase()}` : ''}
      </Box>
      <Box>
        {[
          cell.down ? null : t('overview.hostMap.fill', { pct: percent(cell.fillRatio) }),
          cell.down ? t('overview.hostMap.down') : t('overview.hostMap.up'),
          cell.out ? t('overview.hostMap.out') : t('overview.hostMap.in'),
        ].filter(Boolean).join(sep)}
      </Box>
      {!cell.down && (
        <Box>
          {latency(osd)}
          {typeof osd.pgs === 'number' && <>{sep}{t('overview.hostMap.pgs', { count: osd.pgs })}</>}
        </Box>
      )}
      {flags.length > 0 && <Box>{t('overview.hostMap.flags', { flags: flags.join(t('ui.listSeparator')) })}</Box>}
      {issues.map(i => <Box key={i.code} sx={{ fontWeight: 600 }}>{i.code}</Box>)}
    </Box>
  )
}

/**
 * One square of the dense grid. Memoised on stable inputs (the OSD object of the inventory,
 * the thresholds as numbers, flag and issue lists that keep their identity between polls):
 * a Live tick that changes nothing renders none of the 500 squares again.
 */
const DenseCell = memo(function DenseCell({ osd, nearfull, full, flags, issues, onOpen }: {
  osd: CephOsd
  nearfull: number
  full: number
  flags: string[]
  issues: OsdIssue[]
  onOpen: (id: number) => void
}) {
  const t = useTranslations('cephCockpit')
  const percent = usePercent()
  const theme = useTheme()
  const p = paletteOf(theme)
  const cell = osdCell(osd, flags)
  const tone = fillTone(cell.fillRatio, { nearfull, full })
  const paint = denseFill(theme, tone)
  const label = [
    osd.name || `osd.${osd.id}`,
    cell.down ? t('overview.hostMap.down') : t('overview.hostMap.fill', { pct: percent(cell.fillRatio) }),
    cell.out ? t('overview.hostMap.out') : null,
    ...issues.map(i => i.code),
  ].filter(Boolean).join(t('ui.listSeparator'))

  return (
    <Tooltip title={<CellSummary osd={osd} flags={flags} issues={issues} />} disableInteractive enterDelay={120} placement='top'>
      <Box
        component='button'
        type='button'
        data-testid='osd-cell'
        data-osd={osd.id}
        data-tone={tone}
        data-down={cell.down ? 'true' : 'false'}
        data-out={cell.out ? 'true' : 'false'}
        aria-label={label}
        onClick={() => onOpen(osd.id)}
        sx={{
          position: 'relative', width: CELL, height: CELL, p: 0, border: 0, borderRadius: '3px', cursor: 'pointer', flex: 'none',
          transition: 'transform 100ms',
          '&:hover': { transform: 'scale(1.25)', zIndex: 1 },
          '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 },
        }}
        style={{
          ...(cell.down ? { backgroundColor: p.background.paper, boxShadow: `inset 0 0 0 2px ${p.error.main}` } : paint),
          opacity: cell.out ? 0.4 : undefined,
        }}
      >
        {cell.flagged && (
          <Box
            component='span'
            data-testid='osd-flag'
            sx={{ position: 'absolute', top: -3, right: -3, width: 6, height: 6, borderRadius: '50%', bgcolor: 'info.main' }}
            style={{ boxShadow: `0 0 0 1.5px ${p.background.paper}` }}
          />
        )}
      </Box>
    </Tooltip>
  )
})

function Swatch({ paint, outline, dim, dot }: { paint: DensePaint; outline?: string; dim?: boolean; dot?: boolean }) {
  return (
    <Box
      component='span'
      data-testid='host-map-swatch'
      sx={{ position: 'relative', display: 'inline-block', width: 10, height: 10, borderRadius: '2px', flex: 'none' }}
      style={{ backgroundColor: paint.backgroundColor, backgroundImage: paint.backgroundImage, boxShadow: outline ? `inset 0 0 0 1.5px ${outline}` : paint.boxShadow, opacity: dim ? 0.4 : undefined }}
    >
      {dot && <Box component='span' sx={{ position: 'absolute', top: -2, right: -2, width: 5, height: 5, borderRadius: '50%', bgcolor: 'info.main' }} />}
    </Box>
  )
}

function DenseLegend({ ratios }: { ratios: Ratios }) {
  const t = useTranslations('cephCockpit')
  const percent = usePercent()
  const theme = useTheme()
  const p = paletteOf(theme)
  const items: { key: string; swatch: ReactNode; label: string }[] = [
    { key: 'low', swatch: <Swatch paint={denseFill(theme, 'low')} />, label: t('overview.hostMap.legendLow', { pct: percent(DENSE_MID_RATIO) }) },
    { key: 'mid', swatch: <Swatch paint={denseFill(theme, 'mid')} />, label: t('overview.hostMap.legendMid', { from: percent(DENSE_MID_RATIO), to: percent(ratios.nearfull) }) },
    { key: 'nearfull', swatch: <Swatch paint={denseFill(theme, 'nearfull')} />, label: t('overview.hostMap.legendAbove', { pct: percent(ratios.nearfull) }) },
    { key: 'full', swatch: <Swatch paint={denseFill(theme, 'full')} />, label: t('overview.hostMap.legendAbove', { pct: percent(ratios.full) }) },
    { key: 'down', swatch: <Swatch paint={{ backgroundColor: p.background.paper }} outline={p.error.main} />, label: t('overview.hostMap.down') },
    { key: 'out', swatch: <Swatch paint={denseFill(theme, 'mid')} dim />, label: t('overview.hostMap.out') },
    { key: 'flag', swatch: <Swatch paint={denseFill(theme, 'low')} dot />, label: t('overview.hostMap.flag') },
  ]

  return (
    <Box data-testid='host-map-legend' sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', columnGap: 1.75, rowGap: 0.5, mb: 1.25 }}>
      {items.map(i => (
        <Box key={i.key} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.625 }}>
          {i.swatch}
          <Typography component='span' variant='caption' color='text.secondary' sx={TABULAR}>{i.label}</Typography>
        </Box>
      ))}
    </Box>
  )
}

function SummaryBadge({ host, ratios }: { host: HostGroup; ratios: Ratios }) {
  const t = useTranslations('cephCockpit')
  const percent = usePercent()
  const s = hostSummary(host.osds, ratios)
  const text = s.tone === 'down'
    ? t('overview.hostMap.downCount', { count: s.down })
    : s.tone === 'ok'
      ? t('overview.hostMap.avg', { pct: percent(s.avg) })
      : t('overview.hostMap.max', { pct: percent(s.max) })

  return (
    <Box data-testid='host-summary' sx={{ flex: 'none', minWidth: 72, textAlign: 'right' }}>
      {s.tone === 'ok' ? (
        <Typography component='span' variant='caption' color='text.secondary' sx={TABULAR}>{text}</Typography>
      ) : (
        <Tag tone={s.tone === 'nearfull' ? 'warning' : 'error'}>{text}</Tag>
      )}
    </Box>
  )
}

type CellInputs = Map<number, { flags: string[]; issues: OsdIssue[] }>

function DenseMap({ inventory, hosts, ratios, hostFlags, osdFlags, issues, onOpenOsd }: MapBodyProps) {
  const t = useTranslations('cephCockpit')
  const flagsOf = (name: string) => hostFlagsForNode(hostFlags, name).flags
  const nameWidth = denseNameWidth(hosts, flagsOf)

  // Flags and issues of each OSD, rebuilt only when the inventory, the flags or the checks change.
  const cells = useMemo<CellInputs>(() => {
    const out: CellInputs = new Map()

    for (const host of hosts) {
      for (const osd of host.osds) {
        const flags = flagsOnOsd(osd.id, host.name, osdFlags, hostFlags).map(f => f.flag)

        out.set(osd.id, { flags: flags.length > 0 ? flags : NO_FLAGS, issues: issues.get(osd.id) ?? NO_ISSUES })
      }
    }

    return out
  }, [hosts, hostFlags, osdFlags, issues])

  return (
    <>
      <DenseLegend ratios={ratios} />
      <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${denseRowMinWidth(hosts, flagsOf)}px), 1fr))`, columnGap: 3 }}
        data-testid='host-grid'
      >
        {hosts.map(host => (
          <Box
            key={host.name}
            data-testid='host-row'
            sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.875, borderBottom: '1px solid', borderColor: 'divider', minWidth: 0 }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flex: `0 1 ${nameWidth}px`, minWidth: 0, overflow: 'hidden' }}>
              <HostGlyph host={host.name} inventory={inventory} />
              <Typography component='span' title={host.name} sx={{ fontSize: 13, fontWeight: 700, minWidth: 0, flex: '0 4 auto' }} noWrap>{host.name}</Typography>
              <Typography component='span' variant='caption' color='text.secondary' sx={{ ...TABULAR, flex: 'none' }}>
                {t('overview.hostMap.osdCount', { count: host.osds.length })}
              </Typography>
              <Box data-testid='host-tags' sx={{ display: 'flex', gap: 0.5, flex: '0 1 auto', minWidth: 0, overflow: 'hidden' }}>
                <HostTags host={host} flags={hostFlagsForNode(hostFlags, host.name).flags} t={t} />
              </Box>
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '3px', flex: '1 1 0', minWidth: 0 }}>
              {host.osds.map(osd => {
                const inputs = cells.get(osd.id)

                return (
                  <DenseCell
                    key={osd.id}
                    osd={osd}
                    nearfull={ratios.nearfull}
                    full={ratios.full}
                    flags={inputs?.flags ?? NO_FLAGS}
                    issues={inputs?.issues ?? NO_ISSUES}
                    onOpen={onOpenOsd}
                  />
                )
              })}
            </Box>
            <SummaryBadge host={host} ratios={ratios} />
          </Box>
        ))}
      </Box>
    </>
  )
}

interface MapBodyProps {
  inventory: CephInventory
  hosts: HostGroup[]
  ratios: Ratios
  hostFlags: ScopedFlagMap
  osdFlags: ScopedFlagMap
  issues: Map<number, OsdIssue[]>
  onOpenOsd: (id: number) => void
}

/** A key that changes only when what a check says changes: the checks of a Live tick are a new array every 5 s. */
const checksKey = (checks: CephHealthIssue[]) =>
  checks.map(c => `${c.severity}\u0001${c.name}\u0001${c.detail.map(d => d.message).join('\u0002')}`).join('\u0000')

export default function HostMap({ inventory, ratios, onOpenOsd, hostFlags = EMPTY_FLAGS, osdFlags = EMPTY_FLAGS, checks = EMPTY_CHECKS, action, problemOnly = false, onProblemOnlyChange, view = null, onViewChange }: HostMapProps) {
  const t = useTranslations('cephCockpit')
  const allHosts = useMemo(() => hostGroups(inventory), [inventory])
  const stableChecks = useStableByKey(checks, checksKey(checks))
  const issues = useMemo(() => osdIssues(stableChecks), [stableChecks])
  const mode = view ? (view === 'dense' ? 'dense' : 'cards') : hostMapMode(allHosts)
  const canFilter = mode === 'dense' && allHosts.length > DENSE_PROBLEM_FILTER_MIN_HOSTS
  const filtering = canFilter && problemOnly
  const hosts = useMemo(() => (filtering ? problemHosts(allHosts, { ratios, issues }) : allHosts), [filtering, allHosts, ratios, issues])
  const hidden = allHosts.length - hosts.length
  const body = { inventory, hosts, ratios, hostFlags, osdFlags, issues, onOpenOsd }

  const header = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      {onViewChange && (
        <ToggleButtonGroup
          size='small'
          exclusive
          value={mode === 'dense' ? 'dense' : 'compact'}
          aria-label={t('overview.hostMap.view.label')}
          data-testid='host-map-view'
          sx={{ bgcolor: 'background.paper' }}
        >
          {(['compact', 'dense'] as const).map(v => (
            <ToggleButton key={v} value={v} sx={TOGGLE_SX} onClick={() => onViewChange(v)} data-testid={`host-map-view-${v}`}>{t(`overview.hostMap.view.${v}`)}</ToggleButton>
          ))}
        </ToggleButtonGroup>
      )}
      {canFilter && (
        <FormControlLabel
          sx={{ m: 0 }}
          control={<Switch size='small' checked={problemOnly} onChange={(_, on) => onProblemOnlyChange?.(on)} slotProps={{ input: { 'data-testid': 'host-problem-toggle' } as object }} />}
          label={<Typography component='span' sx={{ fontSize: 12.5, fontWeight: 600 }}>{t('overview.hostMap.problemOnly')}</Typography>}
        />
      )}
      {action}
    </Box>
  )

  return (
    <Box data-testid='host-map' data-mode={mode} sx={fillCardLg}>
      <SectionCard
        icon='ri-server-line'
        title={t('overview.hostMap.title')}
        subtitle={mode === 'cards' ? t('overview.hostMap.legendCards') : filtering ? t('overview.hostMap.hiddenHealthy', { count: hidden }) : undefined}
        action={header}
      >
        {allHosts.length === 0 ? (
          <Typography variant='body2' color='text.secondary'>{t('overview.hostMap.empty')}</Typography>
        ) : hosts.length === 0 ? (
          <Typography variant='body2' color='text.secondary' data-testid='host-map-no-problem'>{t('overview.hostMap.noProblemHost')}</Typography>
        ) : mode === 'cards' ? (
          <CardsMap {...body} />
        ) : (
          <DenseMap {...body} />
        )}
      </SectionCard>
    </Box>
  )
}
