'use client'

import { useMemo, useState } from 'react'

import { Box, Button, Collapse, Typography } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useFormatter, useTranslations } from 'next-intl'

import { exporterHelp } from '@/lib/ceph/exporterFailure'
import { CEPH_EXPORTER_INSTALL_STEPS } from '@/lib/ceph/exporterInstall'
import { mergeIoSeries } from '@/lib/ceph/osdIo'
import { formatByteRate, formatOps } from '@/lib/ceph/ioFormat'
import type { CephRange } from '@/lib/ceph/types'
import { useToast } from '@/contexts/ToastContext'

import { useCephExporterPort } from './hooks/useCephExporterPort'
import { useOsdExporterLive } from './hooks/useOsdExporterLive'
import { useOsdIoHistory } from './hooks/useOsdIoHistory'
import { Eyebrow, HostGlyph, SparkLines, TABULAR, toneColor, TrendSlot, type IoTone } from './ui'

/*
   "Activity" section of the OSD sheet: read and write IOPS and throughput of the OSD, from the
   ceph-exporter of its node. Values are the latest real-time rate; the curves are the session
   buffer (5 min), preceded by the stored history in Enterprise (the cockpit period, the last hour
   in Live). Exporter not reachable: an information box that says why (nothing listens, no answer in
   time, unexpected answer) and, when the package may be missing, the install procedure (collapsible,
   copyable). The exporter answers but does not report this OSD: a different message.
*/

const CHART_HEIGHT = 72

interface Props {
  conn: string
  node: string | null
  host: string
  inventory: Parameters<typeof HostGlyph>[0]['inventory']
  osd: number
  enterprise: boolean
  range: CephRange
}

function Legend({ tone, dashed, label }: { tone: IoTone; dashed?: boolean; label: string }) {
  const theme = useTheme()

  return (
    <Box component='span' sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
      <Box component='svg' aria-hidden viewBox='0 0 16 4' sx={{ width: 16, height: 4, flexShrink: 0 }}>
        <line x1='0' y1='2' x2='16' y2='2' strokeWidth={2} strokeDasharray={dashed ? '4 3' : undefined} style={{ stroke: toneColor(theme, tone) }} />
      </Box>
      <Typography component='span' variant='caption' color='text.secondary' noWrap>{label}</Typography>
    </Box>
  )
}

export default function OsdActivity({ conn, node, host, inventory, osd, enterprise, range }: Readonly<Props>) {
  const t = useTranslations('cephCockpit')
  const format = useFormatter()
  const toast = useToast()
  const [showSteps, setShowSteps] = useState(false)
  const live = useOsdExporterLive(conn, node, osd, true)
  const history = useOsdIoHistory(conn, osd, range, enterprise, true)
  const down = live.status === 'unreachable'
  const notExported = live.status === 'not_exported'
  const port = useCephExporterPort(conn, down)
  const help = exporterHelp(live.reason, !!node)
  // Latest real-time rate, else the last stored point of the period (the curves have points before the first live sample).
  const current = live.points.at(-1) ?? history.points.at(-1)
  // In Live the curves are the history of the last hour then the real-time points; over a period, the history alone.
  const points = useMemo(() => (range === 'live' ? mergeIoSeries(history.points, live.points) : history.points), [range, history.points, live.points])
  const chartState = history.state
  const enough = points.length >= 2
  const period = range === 'live' ? '' : t(`range.${range}`)

  const num = (v: number) => formatOps(format, v)
  const rate = (v: number) => formatByteRate(format, v)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(CEPH_EXPORTER_INSTALL_STEPS)
      toast.success(t('osd.activity.copied'))
    } catch {
      toast.error(t('osd.activity.copyFailed'))
    }
  }

  let body
  let caption: string | null = null

  if (!node) {
    body = (
      <Box data-testid='osd-activity-nonode' sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75 }}>
        <HostGlyph host={host} inventory={inventory} />
        <Typography variant='body2' color='text.secondary'>{t('osd.activity.noNode', { host })}</Typography>
      </Box>
    )
  } else if (down) {
    body = (
      <Box data-testid='osd-activity-info' sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5, bgcolor: 'action.hover' }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
          <i className='ri-information-line' style={{ fontSize: 18, marginTop: 1 }} aria-hidden />
          <Typography variant='body2'>{t(`osd.activity.${help.messageKey}`, { port, node: node ?? '' })}</Typography>
        </Box>
        {help.install && (
          <>
            <Button
              size='small'
              color='inherit'
              onClick={() => setShowSteps(v => !v)}
              aria-expanded={showSteps}
              endIcon={<i className={showSteps ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} aria-hidden />}
              sx={{ textTransform: 'none', fontWeight: 600, mt: 0.5, ml: 3.25 }}
            >
              {t(showSteps ? 'osd.activity.hideSteps' : 'osd.activity.showSteps')}
            </Button>
            <Collapse in={showSteps} unmountOnExit>
              <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mt: 1 }}>{t('osd.activity.stepsIntro')}</Typography>
              <Box
                component='pre'
                data-testid='osd-activity-steps'
                sx={{ m: 0, mt: 0.75, p: 1.25, fontSize: 11.5, lineHeight: 1.5, overflowX: 'auto', whiteSpace: 'pre', border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper' }}
              >
                {CEPH_EXPORTER_INSTALL_STEPS}
              </Box>
              <Button size='small' variant='outlined' color='inherit' onClick={() => void copy()} startIcon={<i className='ri-file-copy-line' aria-hidden />} sx={{ textTransform: 'none', mt: 1 }}>
                {t('osd.activity.copy')}
              </Button>
            </Collapse>
          </>
        )}
      </Box>
    )
  } else if (notExported) {
    body = (
      <Box data-testid='osd-activity-not-exported' sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75 }}>
        <HostGlyph host={node} inventory={inventory} />
        <Typography variant='body2' color='text.secondary'>{t('osd.activity.notExported', { node, id: osd })}</Typography>
      </Box>
    )
  } else {
    const panel = (title: string, read: number | undefined, write: number | undefined, fmt: (v: number) => string, pick: 'ops' | 'bytes') => {
      const readSeries = points.map(p => (pick === 'ops' ? p.readOps : p.readBytes))
      const writeSeries = points.map(p => (pick === 'ops' ? p.writeOps : p.writeBytes))
      const measuring = read === undefined || write === undefined

      return (
        <Box sx={{ minWidth: 0 }} data-testid={`osd-activity-${pick}`}>
          <Typography variant='caption' color='text.secondary' sx={{ display: 'block', fontWeight: 600 }}>{title}</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 1, alignItems: 'center', mt: 0.5 }}>
            <Legend tone='read' label={t('osd.activity.read')} />
            <Typography component='span' variant='body2' sx={{ ...TABULAR, fontWeight: 600, textAlign: 'right' }}>{measuring ? '-' : fmt(read)}</Typography>
            <Legend tone='write' dashed label={t('osd.activity.write')} />
            <Typography component='span' variant='body2' sx={{ ...TABULAR, fontWeight: 600, textAlign: 'right' }}>{measuring ? '-' : fmt(write)}</Typography>
          </Box>
          <Box sx={{ mt: 1 }}>
            {/* Same frame for both charts (tint + zero line), the "measuring" notice included: the two panels line up whatever their values. */}
            <Box data-testid='osd-activity-chart' sx={{ height: CHART_HEIGHT + 4, pt: '2px', px: 0.5, borderRadius: 1, bgcolor: 'action.hover', borderBottom: '1px solid', borderColor: 'divider', boxSizing: 'border-box' }}>
              {chartState === 'live' && !enough && live.status !== 'error' ? (
                <Typography data-testid='osd-activity-measuring' variant='caption' color='text.disabled' sx={{ display: 'flex', alignItems: 'center', height: CHART_HEIGHT }}>{t('osd.activity.measuring')}</Typography>
              ) : (
                <TrendSlot state={chartState} enough={enough} period={period} t={t} height={CHART_HEIGHT}>
                  <SparkLines
                    height={CHART_HEIGHT}
                    series={[{ data: readSeries, tone: 'read' }, { data: writeSeries, tone: 'write', dashed: true }]}
                  />
                </TrendSlot>
              )}
            </Box>
          </Box>
        </Box>
      )
    }

    if (enterprise && range !== 'live') caption = t('osd.activity.captionHistory', { period })
    else if (enterprise) caption = t('osd.activity.captionHistoryLive')
    else caption = t('osd.activity.captionSession')

    body = (
      <>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
          {panel(t('osd.activity.iops'), current?.readOps, current?.writeOps, num, 'ops')}
          {panel(t('osd.activity.throughput'), current?.readBytes, current?.writeBytes, rate, 'bytes')}
        </Box>
        {live.status === 'error' && <Typography data-testid='osd-activity-unavailable' variant='caption' color='text.disabled' sx={{ display: 'block', mt: 1 }}>{t('osd.activity.unavailable')}</Typography>}
        {caption && <Typography variant='caption' color='text.disabled' sx={{ display: 'block', mt: 1 }}>{caption}</Typography>}
      </>
    )
  }

  return (
    <Box data-testid='osd-activity' sx={{ mt: 2.5 }}>
      <Eyebrow>
        <Box sx={{ mb: 0.75 }}>{t('osd.activity.title')}</Box>
      </Eyebrow>
      {body}
    </Box>
  )
}
