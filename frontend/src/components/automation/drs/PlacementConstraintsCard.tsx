'use client'

import { useMemo } from 'react'

import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useTranslations } from 'next-intl'

/** One guest that no node other than its own can run. */
export interface PinnedGuest {
  connection_id: string
  vmid: number
  name: string
  node: string
  reason: string
}

/** One set of nodes the guests of a cluster can move between. */
export interface BalancingDomain {
  connection_id: string
  nodes: string[]
  guests: number
  spread: number
  /** What segmented this domain: 'network' (bridge or SDN VNet), 'storage'. */
  constraints?: string[]
}

interface Props {
  pinnedGuests: PinnedGuest[]
  balancingDomains: BalancingDomain[]
  connectionNames: Record<string, string>
}

/**
 * Why DRS is constrained on a cluster.
 *
 * A cluster cut into role-dedicated SDN zones has a load spread it can never
 * bring down, and guests it can never move. Without this card the page shows
 * an imbalance and no recommendation, which reads as a broken DRS. It renders
 * nothing on a cluster with no placement restriction, which is the common case.
 */
const PlacementConstraintsCard = ({ pinnedGuests, balancingDomains, connectionNames }: Props) => {
  const t = useTranslations()

  // Only multi-domain clusters are worth showing: a single domain covering
  // every node means nothing restricts placement there.
  const constrainedClusters = useMemo(() => {
    const domainsByCluster = new Map<string, BalancingDomain[]>()

    for (const domain of balancingDomains) {
      const list = domainsByCluster.get(domain.connection_id) || []

      list.push(domain)
      domainsByCluster.set(domain.connection_id, list)
    }

    const guestsByCluster = new Map<string, PinnedGuest[]>()

    for (const guest of pinnedGuests) {
      const list = guestsByCluster.get(guest.connection_id) || []

      list.push(guest)
      guestsByCluster.set(guest.connection_id, list)
    }

    const ids = new Set<string>()

    for (const [id, domains] of domainsByCluster) {
      if (domains.length > 1) ids.add(id)
    }

    for (const id of guestsByCluster.keys()) ids.add(id)

    return [...ids]
      .sort((a, b) => (connectionNames[a] || a).localeCompare(connectionNames[b] || b))
      .map(id => ({
        id,
        name: connectionNames[id] || id.slice(0, 12),
        // Every domain is listed, single-node ones included: the cluster chip
        // counts them all, and hiding some here made the tooltip say 4 while
        // the card showed 2. A one-node domain is also the most telling row,
        // it is where the pinned guests sit.
        domains: [...(domainsByCluster.get(id) || [])].sort((a, b) => b.nodes.length - a.nodes.length),
        guests: guestsByCluster.get(id) || []
      }))
  }, [pinnedGuests, balancingDomains, connectionNames])

  if (constrainedClusters.length === 0) return null

  return (
    <Card variant='outlined' sx={{ borderRadius: 2, borderColor: 'warning.main' }}>
      <CardContent>
        <Typography variant='subtitle2' sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className='ri-pushpin-line' style={{ fontSize: 18 }} />
          {t('drsPage.placementConstraints')}
        </Typography>
        <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mt: 0.5 }}>
          {t('drsPage.placementConstraintsDesc')}
        </Typography>

        <Stack spacing={2} sx={{ mt: 2 }}>
          {constrainedClusters.map((cluster, index) => (
            <Box key={cluster.id}>
              {index > 0 && <Divider sx={{ mb: 2 }} />}
              <Typography variant='body2' sx={{ fontWeight: 600, mb: 1 }}>
                {cluster.name}
              </Typography>

              {cluster.domains.length > 0 && (
                <Box sx={{ mb: cluster.guests.length > 0 ? 1.5 : 0 }}>
                  <Typography variant='caption' color='text.secondary'>
                    {t('drsPage.balancingDomainsTitle')}
                  </Typography>
                  <Stack spacing={0.75} sx={{ mt: 0.5 }}>
                    {cluster.domains.map(domain => (
                      <Box
                        key={domain.nodes.join(',')}
                        sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
                      >
                        {domain.nodes.map(node => (
                          <Chip key={node} label={node} size='small' variant='outlined' />
                        ))}
                        <Typography variant='caption' color='text.secondary'>
                          {t('drsPage.domainGuests', { count: domain.guests })}
                        </Typography>
                        {domain.nodes.length > 1 && (
                          <Typography variant='caption' color='text.secondary'>
                            {t('drsPage.domainSpread', { value: domain.spread.toFixed(1) })}
                          </Typography>
                        )}
                        {domain.nodes.length === 1 && (
                          <Typography variant='caption' color='warning.main'>
                            {t('drsPage.domainNoTarget')}
                          </Typography>
                        )}
                      </Box>
                    ))}
                  </Stack>
                </Box>
              )}

              {cluster.guests.length > 0 && (
                <Box>
                  <Typography variant='caption' color='text.secondary'>
                    {t('drsPage.pinnedGuestsTitle')}
                  </Typography>
                  <Stack spacing={0.75} sx={{ mt: 0.5 }}>
                    {cluster.guests.map(guest => (
                      <Box
                        key={`${guest.connection_id}-${guest.vmid}`}
                        sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
                      >
                        <Tooltip title={guest.reason} arrow>
                          <Chip
                            label={`${guest.name} (${guest.vmid})`}
                            size='small'
                            color='warning'
                            variant='outlined'
                          />
                        </Tooltip>
                        <Typography variant='caption' color='text.secondary'>
                          {t('drsPage.pinnedGuestOn', { node: guest.node })}
                        </Typography>
                        <Typography variant='caption' color='text.secondary' sx={{ opacity: 0.8 }}>
                          {guest.reason}
                        </Typography>
                      </Box>
                    ))}
                  </Stack>
                </Box>
              )}
            </Box>
          ))}
        </Stack>
      </CardContent>
    </Card>
  )
}

export default PlacementConstraintsCard
