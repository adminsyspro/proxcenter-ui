'use client'

import { Dialog, DialogContent, DialogTitle, IconButton, Typography, useTheme } from '@mui/material'
import { useTranslations } from 'next-intl'

import LogLineDetails from '@/components/firewall/LogLineDetails'
import type { FirewallLogRow } from '@/lib/api/firewall'
import type { ParsedLogLine } from '@/lib/firewall/logParse'

import type { MapMember } from './zoneGraph'

const ACTION_ICONS: Record<string, string> = { DROP: 'ri-forbid-2-line', REJECT: 'ri-close-circle-line', ACCEPT: 'ri-checkbox-circle-line' }

/**
 * A line of a guest's firewall log as a row of the Firewall log view: what decided it (a security group, the default
 * policy, the guest's own rules or the host's), on the guest's node. Nothing is read: the line holds it all.
 */
export function logRowOf(p: ParsedLogLine, node: string, key: number): FirewallLogRow {
  let origin: FirewallLogRow['origin'] = 'host'
  if (p.group) origin = 'group'
  else if (p.vmid > 0 || p.guestVmid !== undefined) origin = 'guest'
  return {
    id: String(key), node, ts: p.ts, level: p.level, chain: p.chain, direction: p.direction, action: p.action, actionInferred: false, policy: p.policy,
    origin, group: p.group, vmid: p.vmid > 0 ? p.vmid : p.guestVmid, src: p.src, dst: p.dst, proto: p.proto, sport: p.sport, dport: p.dport,
    icmpType: p.icmpType, raw: p.raw,
  }
}

type Props = { guest: MapMember; line: ParsedLogLine; lineKey: number; onClose: () => void }

/**
 * The details of one line of the guest's firewall log, opened by a double click on it: the same cards as the Firewall
 * log view (what decided, the flow, the interfaces, the IP and TCP header), then the raw line to copy.
 */
export default function GuestLogLineDialog({ guest, line, lineKey, onClose }: Readonly<Props>) {
  const t = useTranslations()
  const theme = useTheme()
  const row = logRowOf(line, guest.node, lineKey)
  const colours: Record<string, string> = { DROP: theme.palette.error.main, REJECT: theme.palette.warning.main, ACCEPT: theme.palette.success.main }
  let decidedBy = t('firewallLog.byHost')
  if (row.origin === 'group') decidedBy = t('firewallLog.byGroup', { name: row.group || '' })
  else if (row.policy) decidedBy = t('firewallLog.byPolicy')
  else if (row.origin === 'guest') decidedBy = t('firewallLog.byGuestRule')
  const title = t('microsegPilot.overview.guestPanel.lineTitle', { name: guest.name })
  return (
    <Dialog open onClose={onClose} maxWidth='lg' fullWidth aria-label={title}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <Typography component='span' variant='h6' noWrap sx={{ flex: '1 1 0', minWidth: 0 }}>{title}</Typography>
        <IconButton size='small' aria-label={t('common.close')} onClick={onClose}><i className='ri-close-line' /></IconButton>
      </DialogTitle>
      {/* MUI drops the top padding of a content under its title: the cards keep a gap under it. */}
      <DialogContent sx={{ '&&': { pt: 1 } }}>
        <LogLineDetails
          row={row}
          guest={{ name: guest.name, type: guest.type, status: guest.status }}
          decidedBy={decidedBy}
          actionColor={(row.action && colours[row.action]) || theme.palette.text.disabled}
          actionIcon={(row.action && ACTION_ICONS[row.action]) || 'ri-question-line'}
        />
      </DialogContent>
    </Dialog>
  )
}
