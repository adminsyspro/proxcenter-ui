'use client'

import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'

import { Box, Button, CircularProgress, Dialog, DialogContent, DialogTitle, IconButton, Tooltip, Typography, useMediaQuery } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useFormatter, useTranslations } from 'next-intl'

import type { OkToStopPayload } from '@/lib/ceph/okToStop'
import type { OsdIssue } from '@/lib/ceph/hostMap'
import { osdOutImpact } from '@/lib/ceph/osdOutImpact'
import { poolsOnOsd, projectedBefore, toOsdLoad } from '@/lib/ceph/osdTable'
import { binaryUnit, osdLatencyMs } from '@/lib/ceph/overview'
import type { CephInventory, CephOsd, CephRange } from '@/lib/ceph/types'
import { useToast } from '@/contexts/ToastContext'

import OsdActionConfirm, { type OsdRiskyAction } from './OsdActionConfirm'
import OsdActivity from './OsdActivity'
import { fetchOkToStop, postOsdAction, postOsdService, type OsdQuickAction } from './osdActions'
import { CephOsdGlyph, Eyebrow, HostGlyph, isTypingTarget, Row, StateDot, Tag, TABULAR, ThresholdBar, usePercent } from './ui'

/*
   Sheet of one OSD, in a centered modal (two columns from md up): state, fill, latencies,
   PGs, weights, device class, the pools that can place data on it, version, and the
   actions. Up and down arrows move to the previous and next OSD of the table. Scrub,
   deep-scrub and in start at once; out, stop and restart open the confirmation modal.
*/

const TIB = 1024 ** 4

export interface OsdDrawerProps {
  conn: string
  /** The PVE node the OSD runs on, resolved from its CRUSH host; null when no node matches (the actions are off). */
  node: string | null
  osd: CephOsd
  inventory: CephInventory
  ratios: { nearfull: number; full: number }
  issues?: OsdIssue[]
  /** Flags that apply to the OSD (its own and its host's). */
  flags?: string[]
  /** Acting on OSDs needs storage.admin. */
  canManage: boolean
  /** Enterprise: the activity curves start from the stored history. */
  enterprise: boolean
  /** The cockpit period (Live = the last hour of history, then real time). */
  range: CephRange
  hasPrev: boolean
  hasNext: boolean
  onClose: () => void
  onPrev: () => void
  onNext: () => void
  /** An action was accepted: the caller rereads the inventory. */
  onDone: () => void
}

/** The modal of out, stop or restart: asks ok-to-stop when it opens, estimates the impact, then acts. */
function RiskyActionDialog({ conn, node, osd, inventory, ratios, action, onClose, onDone }: {
  conn: string
  node: string
  osd: CephOsd
  inventory: CephInventory
  ratios: { nearfull: number; full: number }
  action: OsdRiskyAction
  onClose: () => void
  onDone: () => void
}) {
  const t = useTranslations('cephCockpit.osd')
  const toast = useToast()
  const [verdict, setVerdict] = useState<OkToStopPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const osds = inventory.osds.list
  const impact = useMemo(() => osdOutImpact(osds.map(toOsdLoad), osd.id, ratios), [osds, osd.id, ratios])
  const before = projectedBefore(osds, impact)
  const { id } = osd

  useEffect(() => {
    const controller = new AbortController()
    // The state writes live in this function, not in the effect body (react-hooks/set-state-in-effect).
    const run = async () => {
      const payload = await fetchOkToStop(conn, node, { id }, controller.signal)

      if (controller.signal.aborted) return
      setVerdict(payload)
      setLoading(false)
    }

    void run()

    return () => controller.abort()
  }, [conn, node, id])

  const confirm = async (force: boolean) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = action === 'out' ? await postOsdAction(conn, node, osd, 'out', force) : await postOsdService(conn, node, osd, action, force)

      if (result.ok) {
        toast.success(t(`actions.${action}Started`, { id }))
        onDone()
        onClose()

        return
      }

      // Ceph refused between the precheck and the action: the modal now asks for the name.
      if (result.code === 'not_ok_to_stop' && !force) {
        const seen = result.okToStop

        setVerdict({
          ok: false,
          osds: seen?.osds ?? [id],
          numOkPgs: seen?.numOkPgs ?? 0,
          numNotOkPgs: seen?.numNotOkPgs ?? 0,
          message: seen ? (seen.message ?? null) : (result.error ?? null),
        })
        setNotice(t('confirm.refusedNow'))

        return
      }

      setError(result.error || `HTTP ${result.status}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <OsdActionConfirm
      action={action}
      osd={osd}
      impact={impact}
      okToStop={verdict}
      loading={loading}
      ratios={ratios}
      beforeRatio={before}
      busy={busy}
      error={error}
      notice={notice}
      onConfirm={force => void confirm(force)}
      onCancel={onClose}
    />
  )
}

export default function OsdDrawer({ conn, node, osd, inventory, ratios, issues = [], flags = [], canManage, enterprise, range, hasPrev, hasNext, onClose, onPrev, onNext, onDone }: Readonly<OsdDrawerProps>) {
  const t = useTranslations('cephCockpit')
  const format = useFormatter()
  const percent = usePercent()
  const toast = useToast()
  const theme = useTheme()
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'))
  const titleId = useId()
  const [risky, setRisky] = useState<OsdRiskyAction | null>(null)
  const [busy, setBusy] = useState<OsdQuickAction | 'start' | null>(null)
  const load = toOsdLoad(osd)
  const pools = useMemo(() => poolsOnOsd(inventory, osd), [inventory, osd])
  const latency = osdLatencyMs(osd)
  const sep = t('ui.separator')
  // Up and down arrows walk the table, except in a field and while a modal is open.
  useEffect(() => {
    if (risky) return

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || isTypingTarget(e.target)) return
      // Full screen and a focus inside the scrolling body: the arrows scroll the sheet, they do not walk the table.
      if (fullScreen || (e.target as Element | null)?.closest?.('.MuiDialogContent-root')) return
      if (e.key === 'ArrowDown' && hasNext) {
        e.preventDefault()
        onNext()
      } else if (e.key === 'ArrowUp' && hasPrev) {
        e.preventDefault()
        onPrev()
      }
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [risky, fullScreen, hasPrev, hasNext, onPrev, onNext])

  type QuickId = OsdQuickAction | 'start'

  // Scrub, deep-scrub and in on the OSD route, start on the service route: no confirmation for any of them.
  const quick = async (action: QuickId) => {
    if (!node) return
    setBusy(action)
    try {
      const result = action === 'start' ? await postOsdService(conn, node, osd, 'start') : await postOsdAction(conn, node, osd, action)

      if (result.ok) {
        toast.success(t(`osd.actions.${action === 'deep-scrub' ? 'deepScrub' : action}Started`, { id: osd.id }))
        onDone()
      } else {
        toast.error(t('osd.actions.failed', { id: osd.id, error: result.error || `HTTP ${result.status}` }))
      }
    } finally {
      setBusy(null)
    }
  }

  const reason = (action: QuickId | 'out' | 'stop' | 'restart'): string | null => {
    if (!canManage) return t('osd.actions.noPermission')
    if (!node) return t('osd.actions.nodeUnknown', { host: osd.host })
    if (busy) return null
    if (action === 'in' && osd.in) return t('osd.actions.alreadyIn', { id: osd.id })
    if (action === 'out' && !osd.in) return t('osd.actions.alreadyOut', { id: osd.id })
    if (action === 'start' && osd.up) return t('osd.actions.alreadyRunning', { id: osd.id })
    if (action !== 'in' && action !== 'out' && action !== 'start' && !osd.up) return t('osd.actions.notRunning', { id: osd.id })

    return null
  }

  // A down OSD offers Start where an up one offers Restart.
  const ACTIONS: { id: QuickId | 'out' | 'stop' | 'restart'; icon: string; label: string; danger?: boolean; onClick: () => void }[] = [
    { id: 'deep-scrub', icon: 'ri-search-eye-line', label: t('osd.actions.deepScrub'), onClick: () => void quick('deep-scrub') },
    { id: 'scrub', icon: 'ri-search-line', label: t('osd.actions.scrub'), onClick: () => void quick('scrub') },
    osd.up
      ? { id: 'restart', icon: 'ri-restart-line', label: t('osd.actions.restart'), onClick: () => setRisky('restart') }
      : { id: 'start', icon: 'ri-play-line', label: t('osd.actions.start'), onClick: () => void quick('start') },
    { id: 'stop', icon: 'ri-stop-circle-line', label: t('osd.actions.stop'), danger: true, onClick: () => setRisky('stop') },
    { id: 'out', icon: 'ri-logout-box-r-line', label: t('osd.actions.out'), danger: true, onClick: () => setRisky('out') },
    { id: 'in', icon: 'ri-login-box-line', label: t('osd.actions.in'), onClick: () => void quick('in') },
  ]

  const unit = binaryUnit(load.totalBytes)
  const size = (bytes: number) => `${format.number(bytes / unit.divisor, { maximumFractionDigits: 1 })} ${unit.unit}`
  const weight = osd.totalBytes > 0 ? format.number(osd.totalBytes / TIB, { minimumFractionDigits: 4, maximumFractionDigits: 4 }) : t('overview.missing')
  const reweight = typeof osd.reweight === 'number' ? format.number(osd.reweight, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : t('overview.missing')
  const hasVersion = Boolean(osd.version)
  // Also the native tooltip of the truncated subtitle.
  const subtitle = hasVersion
    ? t('osd.drawer.subtitle', { host: osd.host, class: osd.deviceClass, version: osd.version as string })
    : t('osd.drawer.subtitleNoVersion', { host: osd.host, class: osd.deviceClass })

  return (
    <>
      <Dialog open onClose={onClose} aria-labelledby={titleId} maxWidth='md' fullWidth fullScreen={fullScreen} slotProps={{ paper: { 'data-testid': 'osd-drawer' } as object }}>
        <DialogTitle component='div' id={`${titleId}-bar`} sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <CephOsdGlyph osd={osd} />
          {/* One line: the OSD name, then its host and details. */}
          <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography id={titleId} component='h2' noWrap sx={{ fontSize: 15, fontWeight: 700, flex: 'none' }}>{`osd.${osd.id}`}</Typography>
            <HostGlyph host={osd.host} inventory={inventory} />
            <Typography variant='body2' color='text.secondary' noWrap title={subtitle} sx={{ minWidth: 0 }}>{subtitle}</Typography>
          </Box>
          <Tooltip title={t('osd.drawer.prev')}>
            <span><IconButton size='small' aria-label={t('osd.drawer.prev')} disabled={!hasPrev} onClick={onPrev}><i className='ri-arrow-up-s-line' /></IconButton></span>
          </Tooltip>
          <Tooltip title={t('osd.drawer.next')}>
            <span><IconButton size='small' aria-label={t('osd.drawer.next')} disabled={!hasNext} onClick={onNext}><i className='ri-arrow-down-s-line' /></IconButton></span>
          </Tooltip>
          <IconButton size='small' aria-label={t('osd.drawer.close')} onClick={onClose}><i className='ri-close-line' /></IconButton>
        </DialogTitle>

        <DialogContent dividers>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1fr)' }, columnGap: 4, rowGap: 2, alignItems: 'start' }}>
            <Box sx={{ minWidth: 0 }}>
              <Eyebrow>
                <Box sx={{ mb: 0.75 }}>{t('osd.drawer.actions')}</Box>
              </Eyebrow>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, mb: 2.5 }}>
                {ACTIONS.map(a => {
                  const why = reason(a.id)
                  const running = busy === a.id

                  return (
                    <Tooltip key={a.id} title={why ?? ''}>
                      <span>
                        <Button
                          fullWidth
                          size='small'
                          variant='outlined'
                          color={a.danger ? 'error' : 'inherit'}
                          disabled={why !== null || busy !== null}
                          onClick={a.onClick}
                          startIcon={running ? <CircularProgress size={14} /> : <i className={a.icon} style={{ fontSize: 16 }} aria-hidden />}
                          sx={{ textTransform: 'none', fontWeight: 600, fontSize: 12, py: 0.75, borderColor: 'divider', ...(!a.danger && { color: 'text.primary' }) }}
                        >
                          {a.label}
                        </Button>
                      </span>
                    </Tooltip>
                  )
                })}
              </Box>

              <Eyebrow>{t('osd.drawer.fill')}</Eyebrow>
              <ThresholdBar value={osd.usedPct / 100} max={1} nearfull={ratios.nearfull} full={ratios.full} />
              <Typography variant='caption' color='text.secondary' sx={{ ...TABULAR, display: 'block' }}>
                {load.totalBytes > 0
                  ? t('osd.drawer.fillDetail', { used: size(load.usedBytes), total: size(load.totalBytes), free: size(Math.max(0, load.totalBytes - load.usedBytes)) })
                  : t('osd.drawer.fillPct', { pct: percent(osd.usedPct / 100, 1) })}
              </Typography>

              <OsdActivity conn={conn} node={node} host={osd.host} inventory={inventory} osd={osd.id} enterprise={enterprise} range={range} />
            </Box>

            <Box sx={{ minWidth: 0 }}>
              <Box data-testid='osd-drawer-properties'>
                {/* State first in the properties: up/in, then the flags and the checks that concern this OSD. */}
                <Row label={t('osd.drawer.state')} testId='osd-drawer-state-row'>
                  <Box component='span' data-testid='osd-drawer-state' sx={{ display: 'inline-flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end' }}>
                    <StateDot state={osd.up ? 'ok' : 'error'} size={8} />
                    <Tag tone={osd.up ? 'ok' : 'error'}>{t(osd.up ? 'osd.state.up' : 'osd.state.down')}</Tag>
                    <Tag tone={osd.in ? 'ok' : 'warning'}>{t(osd.in ? 'osd.state.in' : 'osd.state.out')}</Tag>
                    {flags.map(f => <Tag key={f} tone='info'>{f}</Tag>)}
                    {issues.map(i => <Tag key={i.code} tone={i.severity}>{i.code}</Tag>)}
                  </Box>
                </Row>
                <Row label={t('osd.drawer.latency')}>
                  {latency === null
                    ? t('overview.missing')
                    : t('osd.drawer.latencyValue', {
                      commit: format.number(osd.commitLatencyMs, { maximumFractionDigits: 1 }),
                      apply: format.number(osd.applyLatencyMs, { maximumFractionDigits: 1 }),
                    })}
                </Row>
                <Row label={t('osd.drawer.pgs')}>{typeof osd.pgs === 'number' ? format.number(osd.pgs) : t('overview.missing')}</Row>
                <Row label={t('osd.drawer.weights')}>{reweight}{' / '}{weight}</Row>
                <Row label={t('osd.drawer.device')}>{osd.deviceClass || t('overview.missing')}</Row>
                {osd.osdType && <Row label={t('osd.drawer.osdType')}>{osd.osdType}</Row>}
                {osd.dataDevice && <Row label={t('osd.drawer.dataDevice')}>{osd.dataDevice}</Row>}
                {osd.dataDevice && <Row label={t('osd.drawer.dbDevice')}>{osd.dbDevice ?? t('osd.drawer.onDataDevice')}</Row>}
                {osd.dataDevice && <Row label={t('osd.drawer.walDevice')}>{osd.walDevice ?? t('osd.drawer.onDataDevice')}</Row>}
                <Row label={t('osd.drawer.pools')}>{pools.length > 0 ? pools.join(t('ui.listSeparator')) : t('osd.drawer.poolsNone')}</Row>
                <Row label={t('osd.drawer.version')}>{osd.version || t('osd.drawer.unknown')}</Row>
                {issues.length > 0 && <Row label={t('osd.drawer.checks')}>{issues.map(i => i.code).join(sep)}</Row>}
              </Box>
            </Box>
          </Box>
        </DialogContent>
      </Dialog>

      {risky && node && (
        <RiskyActionDialog
          key={`${osd.id}-${risky}`}
          conn={conn}
          node={node as string}
          osd={osd}
          inventory={inventory}
          ratios={ratios}
          action={risky}
          onClose={() => setRisky(null)}
          onDone={onDone}
        />
      )}
    </>
  )
}
