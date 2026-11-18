'use client'

import { Box, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { MicrosegApiError } from '@/lib/microseg/api'

import ClusterChip from './ClusterChip'
import { shownClusterName } from './ClusterRunRow'

/**
 * `list`: the rows of the cluster are left out of a list; `state`: its state is unknown because it cannot be reached;
 * `refused`: its state cannot be read (refused or not found), said without claiming it is down.
 */
export type UnreadVariant = 'list' | 'state' | 'refused'

/** The orchestrator or the cluster cannot be reached (network, 502, 503, 504): only then is a cluster said unreachable. */
export function isUnreachable(error: unknown): boolean {
  if (!(error instanceof MicrosegApiError)) return false
  return error.status === 0 || error.status === 502 || error.status === 503 || error.status === 504
    || ['NETWORK', 'ORCHESTRATOR_UNREACHABLE', 'ORCHESTRATOR_TIMEOUT', 'ORCHESTRATOR_ERROR', 'CLUSTER_UNREADABLE'].includes(error.code)
}

const KEY: Record<UnreadVariant, string> = { list: 'unreadList', state: 'unreachable', refused: 'unreadState' }

type Props = {
  /** The failed reads, by connection ID. */
  errors: Readonly<Record<string, unknown>>
  /** The tab's connection: always named, the user opened it. */
  tabConnection: string
  clusterName?: (id: string) => string
  /** What the line says, for every cluster or per failed read. */
  variant?: UnreadVariant | ((error: unknown) => UnreadVariant)
}

/**
 * One line per cluster of a shared policy whose read failed: its warning mark, its chip, and what the screen leaves out.
 * A cluster the user cannot see is said in general words, without its name nor its ID.
 */
export default function ClusterUnreadLines({ errors, tabConnection, clusterName, variant = 'list' }: Props) {
  const t = useTranslations('microsegPilot.merged')
  const ids = Object.keys(errors).sort()
  if (ids.length === 0) return null
  return (
    <Box role='list' data-testid='cluster-unread' sx={{ mb: 1, minWidth: 0 }}>
      {ids.map(id => {
        const name = shownClusterName(id, tabConnection, clusterName)
        const key = KEY[typeof variant === 'function' ? variant(errors[id]) : variant]
        return (
          <Box key={id} role='listitem' sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 32, minWidth: 0 }}>
            <Box component='i' className='ri-error-warning-line' aria-hidden sx={{ color: 'warning.main', fontSize: 18, flexShrink: 0 }} />
            {name !== null && <ClusterChip connectionId={id} name={name} compact />}
            <Typography variant='body2' color='text.secondary' noWrap sx={{ minWidth: 0 }}>
              {name !== null ? t(key) : t(`${key}Other`)}
            </Typography>
          </Box>
        )
      })}
    </Box>
  )
}
