'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { Box, Button, Tooltip, Typography } from '@mui/material'
import { useSWRConfig } from 'swr'
import { useTranslations } from 'next-intl'

import { microsegApi, microsegBaseUrl } from '@/lib/microseg/api'
import type { MicrosegDriftList, MicrosegPolicy } from '@/lib/microseg/types'
import { useMergedClusters } from '@/lib/microseg/useMerged'
import { useClusterDrifts } from '@/lib/microseg/useMicrosegLists'

import MicrosegErrorAlert from './MicrosegErrorAlert'
import { useMicrosegWrite } from './microsegAccess'

const NO_CLUSTERS: string[] = []

/** The drift of a running guest outside every zone on the network of a filtered member. */
export const UNZONED_SAME_NETWORK = 'unzoned_same_network'

/** How many guests outside every zone share the network of an enforced zone, over the clusters that computed their drifts. */
export function unzonedSameNetwork(byCluster: Readonly<Record<string, MicrosegDriftList | undefined>>): number {
  return Object.values(byCluster).reduce((n, list) => n + (list?.computed ? list.drifts.filter(d => d.kind === UNZONED_SAME_NETWORK).length : 0), 0)
}

/**
 * What the banner says of the IP filter: `off` when a zone is enforced and the filter of the policy is off (a member
 * can then send with the address of a member of another zone), `unzoned` the guests outside every zone that share the
 * network of an enforced zone. The drifts are read only where that drift can exist (the filter on, a zone enforced), on
 * `clusterIds` (the Drifts sub-tab's own reads, same keys, the engine's memory).
 */
export function useIPFilterBanner(policy: MicrosegPolicy, clusterIds: readonly string[]): { off: boolean; unzoned: number } {
  const enforced = policy.zones.some(z => z.state === 'enforce')
  const filter = policy.policy.ip_filter
  const reads = useMergedClusters(enforced && filter === true ? clusterIds : NO_CLUSTERS, useClusterDrifts)
  const unzoned = useMemo(() => unzonedSameNetwork(reads.byCluster), [reads.byCluster])
  return { off: enforced && filter === false, unzoned }
}

function BannerLine({ icon, color, text, testId, children }: Readonly<{ icon: string; color: 'info.main' | 'warning.main'; text: string; testId: string; children?: ReactNode }>) {
  return (
    <Box role='listitem' data-testid={testId} sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 32, minWidth: 0 }}>
      <Box component='i' aria-hidden className={icon} sx={{ color, fontSize: 18, flexShrink: 0 }} />
      <Tooltip title={text}>
        <Typography variant='body2' color='text.secondary' noWrap sx={{ flex: '1 1 0', minWidth: 0 }}>{text}</Typography>
      </Tooltip>
      {children}
    </Box>
  )
}

type Props = {
  connectionId: string
  policy: MicrosegPolicy
  off: boolean
  unzoned: number
  /** Opens the Drifts sub-tab; absent: no button. */
  onOpenDrifts?: () => void
}

/**
 * The lines of the banner about the IP filter, each on one line: the filter is off while a zone is enforced, with "Turn
 * on" (PUT /policy `ip_filter: true`, a pending change the admin applies; no button for a read-only user), and the
 * guests outside every zone on the network of an enforced zone, with the way to the Drifts sub-tab.
 */
export default function IPFilterBannerLines({ connectionId, policy, off, unzoned, onOpenDrifts }: Readonly<Props>) {
  const t = useTranslations('microsegPilot.ipFilter.banner')
  const { canWrite } = useMicrosegWrite()
  const { mutate } = useSWRConfig()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<unknown>(null)
  if (!off && unzoned === 0 && failure == null) return null

  const turnOn = async () => {
    setBusy(true)
    setFailure(null)
    try {
      await microsegApi(connectionId).savePolicy({ version: policy.version, ip_filter: true })
    } catch (e) {
      setFailure(e)
    } finally {
      // Read again whatever happened: a refusal for a stale version is cured by the new draft.
      await Promise.resolve(mutate(`${microsegBaseUrl(connectionId)}/policy`)).catch(() => undefined)
      setBusy(false)
    }
  }

  return (
    <Box sx={{ minWidth: 0 }}>
      {failure != null && <MicrosegErrorAlert error={failure} onClose={() => setFailure(null)} />}
      <Box role='list' data-testid='ipfilter-banner' sx={{ minWidth: 0 }}>
        {off && (
          <BannerLine icon='ri-information-line' color='info.main' text={t('off')} testId='ipfilter-banner-off'>
            {canWrite && <Button size='small' variant='outlined' disabled={busy} onClick={() => { void turnOn() }} sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{t('turnOn')}</Button>}
          </BannerLine>
        )}
        {unzoned > 0 && (
          <BannerLine icon='ri-alert-line' color='warning.main' text={t('unzoned', { count: unzoned })} testId='ipfilter-banner-unzoned'>
            {onOpenDrifts && <Button size='small' variant='outlined' onClick={onOpenDrifts} sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{t('seeDrifts')}</Button>}
          </BannerLine>
        )}
      </Box>
    </Box>
  )
}
