'use client'

import { useState, type ReactNode } from 'react'
import { Box, Button, CircularProgress, Dialog, DialogContent, DialogTitle, IconButton, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, Typography } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import { useMicrosegEvents } from '@/lib/microseg/useMicrosegEvents'
import type { MicrosegZone } from '@/lib/microseg/types'

import MicrosegErrorAlert from './MicrosegErrorAlert'
import { DirectionGlyph, ObservedKindGlyph } from './observationParts'
import { formatWhen } from './summaryModel'
import TruncatedText from './TruncatedText'

type TabId = 'traffic' | 'data' | 'logs'
const TABS: TabId[] = ['traffic', 'data', 'logs']
const CELL_SX = { py: 0.5, px: 1, whiteSpace: 'nowrap' } as const

/** The events of the engine's memory that reached or left the zone, newest first, older ones on demand. */
function ZoneLogs({ connectionId, zone }: { connectionId: string; zone: MicrosegZone }) {
  const t = useTranslations('microsegPilot.overview.zonePanel')
  const to = useTranslations('microsegPilot.observation')
  const format = useFormatter()
  const log = useMicrosegEvents(connectionId, { zone: '', verdict: '', q: '' }, true)
  const rows = log.events.filter(e => e.zone === zone.name || e.src_zone === zone.name)
  const known = log.events.length > 0

  return (
    <Box>
      {log.error && !known && <MicrosegErrorAlert error={log.error} onRetry={log.reload} />}
      {log.loading && !known && <CircularProgress size={18} />}
      {!log.loading && !log.error && rows.length === 0 && <Typography variant='body2' color='text.disabled'>{t('logsEmpty')}</Typography>}
      {rows.length > 0 && (
        <Table size='small' stickyHeader aria-label={t('tabLogs')}>
          <TableHead>
            <TableRow>
              <TableCell sx={CELL_SX}>{to('dialog.colTime')}</TableCell>
              <TableCell sx={CELL_SX}>{t('colDirection')}</TableCell>
              <TableCell sx={CELL_SX}>{t('colVerdict')}</TableCell>
              <TableCell sx={CELL_SX}>{to('dialog.colSource')}</TableCell>
              <TableCell sx={CELL_SX}>{to('dialog.colDestination')}</TableCell>
              <TableCell sx={CELL_SX}>{to('columns.service')}</TableCell>
              <TableCell sx={CELL_SX}>{to('dialog.colNode')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map(e => (
              <TableRow key={e.seq} hover data-event={e.seq}>
                <TableCell sx={CELL_SX}>{formatWhen(format, e.ts)}</TableCell>
                <TableCell sx={CELL_SX}>
                  <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}><DirectionGlyph direction={e.direction} />{to(e.direction === 'out' ? 'direction.out' : 'direction.in')}</Box>
                </TableCell>
                <TableCell sx={CELL_SX}>
                  <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}><ObservedKindGlyph kind={e.verdict} />{to(`kind.${e.verdict}`)}</Box>
                </TableCell>
                <TableCell sx={{ ...CELL_SX, maxWidth: 220 }}><TruncatedText text={e.src_ip || e.src_zone || '-'} variant='body2' /></TableCell>
                <TableCell sx={{ ...CELL_SX, maxWidth: 220 }}><TruncatedText text={e.dst_ip || e.guest || '-'} variant='body2' /></TableCell>
                <TableCell sx={CELL_SX}>{`${e.proto}/${e.dport}`}</TableCell>
                <TableCell sx={CELL_SX}>{e.node}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {log.more && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1 }}>
          <Button size='small' onClick={() => { void log.loadOlder() }} disabled={log.olderBusy}>{t('logsOlder')}</Button>
        </Box>
      )}
    </Box>
  )
}

/**
 * The zone panel in a centred dialog, with room: its traffic (chart, summary, top), its data (suggestions, members,
 * flows) and the log of its events, one tab each. The panel's own sections are passed in: same content, same state.
 */
/** One sub-tab of the Data tab: its label (count included), the add button above its content, the content. */
export type DataTab = { id: string; label: string; action?: ReactNode; content: ReactNode }

function ZoneData({ tabs }: { tabs: DataTab[] }) {
  const t = useTranslations('microsegPilot.overview.zonePanel')
  const [id, setId] = useState(tabs[0]?.id ?? '')
  const current = tabs.find(x => x.id === id) ?? tabs[0]
  if (!current) return null
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, borderBottom: 1, borderColor: 'divider', mb: 1.5 }}>
        <Tabs value={current.id} onChange={(_e, v: string) => setId(v)} variant='scrollable' scrollButtons={false} aria-label={t('tabData')} sx={{ flex: 1, minWidth: 0, minHeight: 36 }}>
          {tabs.map(x => <Tab key={x.id} value={x.id} label={x.label} sx={{ minHeight: 36, py: 0.5, textTransform: 'none' }} />)}
        </Tabs>
        {current.action}
      </Box>
      <Box role='tabpanel' data-subtab={current.id}>{current.content}</Box>
    </Box>
  )
}

export default function ZoneExpandDialog({ zone, connectionId, traffic, dataTabs, chips, onClose }: {
  zone: MicrosegZone
  connectionId: string
  traffic: ReactNode
  dataTabs: DataTab[]
  /** The zone's state and outbound chips, after its title. */
  chips: ReactNode
  onClose: () => void
}) {
  const t = useTranslations('microsegPilot.overview.zonePanel')
  const tc = useTranslations('microsegPilot.overview.panel')
  const [tab, setTab] = useState<TabId>('traffic')
  const titleId = 'zone-expand-title'
  return (
    <Dialog open onClose={onClose} maxWidth='lg' fullWidth aria-labelledby={titleId} slotProps={{ paper: { sx: { height: '80vh' } } }}>
      <DialogTitle component='div' id='zone-expand-bar' sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className='ri-shield-fill' style={{ fontSize: 20, color: zone.color || undefined }} />
        <Typography id={titleId} component='h2' variant='h6' sx={{ flexShrink: 0 }}>{t('detailsTitle', { name: zone.name })}</Typography>
        <Typography component='span' variant='body2' color='text.secondary' noWrap sx={{ flex: 1, minWidth: 0 }}>{zone.label}</Typography>
        {chips}
        <IconButton size='small' aria-label={tc('close')} onClick={onClose}><i className='ri-close-line' /></IconButton>
      </DialogTitle>
      <Tabs value={tab} onChange={(_e, v: TabId) => setTab(v)} sx={{ px: 3, borderBottom: 1, borderColor: 'divider', minHeight: 40 }}>
        {TABS.map(id => (
          <Tab key={id} value={id} label={t(id === 'traffic' ? 'tabTraffic' : id === 'data' ? 'tabData' : 'tabLogs')} sx={{ minHeight: 40 }} />
        ))}
      </Tabs>
      <DialogContent sx={{ pt: 2 }}>
        {tab === 'traffic' && traffic}
        {tab === 'data' && <ZoneData tabs={dataTabs} />}
        {tab === 'logs' && <ZoneLogs connectionId={connectionId} zone={zone} />}
      </DialogContent>
    </Dialog>
  )
}
