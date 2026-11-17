'use client'

// Platform status on a high-availability install: one line per node of the
// control plane, with its database role, the VIP, its load and memory, and
// the state of each of its services.

import { Box, Card, CardContent, Chip, Tooltip, Typography } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useTranslations } from 'next-intl'

import { percent, STATE_COLOR } from '@/lib/platform/display'
import { HA_SERVICES } from '@/lib/platform/ha'
import type { HaInfo, HaNode } from '@/lib/platform/types'
import { formatBytes } from '@/utils/format'

const DASH = '-'
const SERVICE_COLOR: Record<string, string> = { running: STATE_COLOR.up, stopped: STATE_COLOR.down, unknown: STATE_COLOR.unknown }
const ROLE_KEY: Record<string, string> = {
  leader: 'rolePrimary',
  sync_standby: 'roleSyncStandby',
  replica: 'roleReplica',
  standby_leader: 'roleStandbyLeader'
}

// One column per service, as wide as its name: the headers are never cut.
const SERVICE_WIDTH: Record<(typeof HA_SERVICES)[number], number> = {
  frontend: 62,
  orchestrator: 84,
  patroni: 56,
  etcd: 44,
  haproxy: 62,
  keepalived: 80,
  weasyprint: 90
}

// Node, database role (with the VIP), version, load, memory, then the services.
const COLUMNS = `minmax(200px, 1fr) 176px 60px 104px 124px ${HA_SERVICES.map(name => `${SERVICE_WIDTH[name]}px`).join(' ')}`

const ROW_SX = {
  display: 'grid',
  gridTemplateColumns: COLUMNS,
  alignItems: 'center',
  columnGap: '10px',
  minHeight: 34,
  px: 1,
  borderBottom: '1px solid',
  borderColor: 'divider',
  '& > *': { minWidth: 0, whiteSpace: 'nowrap' }
} as const

function NodeRow({ node }: Readonly<{ node: HaNode }>) {
  const t = useTranslations('platformStatus')
  const tha = useTranslations('ha.node')
  const dark = useTheme().palette.mode === 'dark'
  const roleKey = node.dbRole ? ROLE_KEY[node.dbRole] : undefined
  const memUsed = node.host ? node.host.memTotalBytes - node.host.memAvailableBytes : 0

  return (
    <Box sx={{ ...ROW_SX, '&:hover': { bgcolor: 'action.hover' } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px', overflow: 'hidden' }}>
        <Box role='img' aria-label={t(`state.${node.state}`)} sx={{ position: 'relative', width: 18, height: 18, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {/* A node of the control plane is a ProxCenter instance: its logo, not a generic server. */}
          <img src={dark ? '/images/proxcenter-logo-dark.svg' : '/images/proxcenter-logo-light.svg'} alt='' width={15} height={15} />
          <Box sx={{ position: 'absolute', right: -1, bottom: -1, width: 7, height: 7, borderRadius: '50%', bgcolor: STATE_COLOR[node.state], border: '1px solid', borderColor: 'background.paper' }} />
        </Box>
        <Typography variant='body2' fontWeight={600} noWrap>
          {node.name}
        </Typography>
        <Typography variant='body2' color='text.secondary' noWrap>
          {node.address}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Typography variant='body2'>{roleKey ? tha(roleKey) : t('ha.dbUnreachable')}</Typography>
        {node.holdsVip && <Chip size='small' color='primary' label='VIP' sx={{ height: 20 }} />}
      </Box>
      <Typography variant='body2' color='text.secondary'>
        {node.version ?? DASH}
      </Typography>
      <Typography variant='body2' color='text.secondary' sx={{ textAlign: 'right' }}>
        {node.host ? t('ha.loadValue', { load: node.host.load1.toFixed(2), cpus: node.host.cpus }) : DASH}
      </Typography>
      <Typography variant='body2' color='text.secondary' sx={{ textAlign: 'right' }}>
        {node.host && node.host.memTotalBytes > 0
          ? `${formatBytes(memUsed, 1)} (${Math.round(percent(memUsed, node.host.memTotalBytes))} %)`
          : DASH}
      </Typography>
      {HA_SERVICES.map(service => {
        const state = node.services[service] ?? 'unknown'
        const known = Object.hasOwn(SERVICE_COLOR, state) ? state : 'unknown'

        return (
          <Tooltip key={service} title={t(`ha.serviceState.${known}`)}>
            <Box
              role='img'
              aria-label={`${service}: ${t(`ha.serviceState.${known}`)}`}
              sx={{ justifySelf: 'center', width: 9, height: 9, borderRadius: '50%', bgcolor: SERVICE_COLOR[known] }}
            />
          </Tooltip>
        )
      })}
    </Box>
  )
}

export default function HaNodesSection({ ha }: Readonly<{ ha: HaInfo }>) {
  const t = useTranslations('platformStatus')

  return (
    <Card variant='outlined'>
      <CardContent sx={{ '&:last-child': { pb: 2 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
          <i className='ri-shield-check-line' style={{ fontSize: 18 }} />
          <Typography variant='subtitle1' fontWeight={700} sx={{ flex: 1 }}>
            {t('ha.title')}
          </Typography>
          {ha.vip && (
            <Typography variant='body2' color='text.secondary'>
              {t('ha.vip', { address: ha.vip })}
            </Typography>
          )}
          {ha.paused && <Chip size='small' color='warning' label={t('ha.paused')} />}
          {!ha.hasLeader && <Chip size='small' color='error' label={t('ha.noLeader')} />}
        </Box>
        <Box sx={{ overflowX: 'auto' }}>
          <Box sx={{ minWidth: 1250 }}>
            <Box sx={{ ...ROW_SX, minHeight: 28, color: 'text.secondary' }}>
              <Typography variant='caption' fontWeight={600}>{t('ha.node')}</Typography>
              <Typography variant='caption' fontWeight={600}>{t('ha.role')}</Typography>
              <Typography variant='caption' fontWeight={600}>{t('services.version')}</Typography>
              <Typography variant='caption' fontWeight={600} sx={{ textAlign: 'right' }}>{t('ha.load')}</Typography>
              <Typography variant='caption' fontWeight={600} sx={{ textAlign: 'right' }}>{t('services.memory')}</Typography>
              {HA_SERVICES.map(service => (
                <Typography key={service} variant='caption' fontWeight={600} sx={{ textAlign: 'center' }}>
                  {service}
                </Typography>
              ))}
            </Box>
            {ha.nodes.map(node => (
              <NodeRow key={node.name} node={node} />
            ))}
          </Box>
        </Box>
      </CardContent>
    </Card>
  )
}
