'use client'

import { Box, Chip, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { MicrosegFlow, MicrosegZone } from '@/lib/microseg/types'
import { serviceLabel, serviceTitle } from '@/lib/network/serviceNames'

type Props = {
  flow: MicrosegFlow
  zonesById: Map<string, MicrosegZone>
  /** Each side (zone name or CIDR) keeps at least this width in a narrow row, cut with an ellipsis beyond; 0 by default. */
  sideMinWidth?: number
}

function Side({ zoneId, cidr, zonesById, minWidth = 0 }: { zoneId: string; cidr: string; zonesById: Map<string, MicrosegZone>; minWidth?: number }) {
  const zone = zoneId ? zonesById.get(zoneId) : undefined
  const text = cidr || zone?.name || zoneId
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth, flex: '0 1 auto' }}>
      {zone && <Box component='span' sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: zone.color || 'text.disabled', flexShrink: 0 }} />}
      <Tooltip title={text}>
        <Typography noWrap fontWeight={zone ? 600 : 400}>{text}</Typography>
      </Tooltip>
    </Box>
  )
}

/** protocol/ports as one token: "tcp/443", "udp", "icmp". */
export function flowService(flow: Pick<MicrosegFlow, 'proto' | 'dport'>): string {
  return flow.dport ? `${flow.proto}/${flow.dport}` : flow.proto
}

/**
 * A flow on one line: source, arrow, destination, protocol/ports. A destination
 * outside any zone (a CIDR) is not compiled in v1, and says so (UA5).
 */
export default function FlowSummary({ flow, zonesById, sideMinWidth = 0 }: Props) {
  const t = useTranslations('microsegPilot.policy.flow')
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: '1 1 auto' }}>
      <Side zoneId={flow.src_zone_id} cidr={flow.src_cidr} zonesById={zonesById} minWidth={sideMinWidth} />
      <i className='ri-arrow-right-line' style={{ flexShrink: 0 }} />
      <Side zoneId={flow.dst_zone_id} cidr={flow.dst_cidr} zonesById={zonesById} minWidth={sideMinWidth} />
      <Tooltip title={serviceTitle(flow.proto, flow.dport)}>
        <Chip size='small' variant='outlined' label={serviceLabel(flow.proto, flow.dport)} sx={{ flexShrink: 0 }} />
      </Tooltip>
      {flow.origin === 'learned' && <Chip size='small' color='info' variant='outlined' label={t('learned')} sx={{ flexShrink: 0 }} />}
      {flow.dst_cidr && (
        <Tooltip title={t('notApplied')}>
          <Chip size='small' color='warning' variant='outlined' label={t('notApplied')} sx={{ minWidth: 0, flexShrink: 1 }} />
        </Tooltip>
      )}
    </Box>
  )
}
