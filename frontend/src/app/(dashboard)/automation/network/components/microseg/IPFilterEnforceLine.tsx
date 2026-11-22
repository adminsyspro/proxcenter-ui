'use client'

import { useMemo, useState } from 'react'
import { Box, Button } from '@mui/material'
import { useTranslations } from 'next-intl'

import { useMicrosegPolicy } from '@/lib/microseg/useMicroseg'
import { useMergedClusters } from '@/lib/microseg/useMerged'
import { useMicrosegIPFilter } from '@/lib/microseg/useMicrosegLists'

import IPFilterDetailsDialog from './IPFilterDetailsDialog'
import { ipFilterCounts } from './ipFilterModel'
import TruncatedText from './TruncatedText'

const NO_CLUSTERS: string[] = []

/** Read once per opening of the confirmation: the engine's memory, no Proxmox call. */
const useFilterOnce = (connId: string | null) => useMicrosegIPFilter(connId, { once: true })

type Props = {
  connectionId: string
  /** Names the clusters of a shared policy in the details; without it only the tab's own is named. */
  clusterName?: (id: string) => string
}

/**
 * One line of the confirmation that enforces the FIRST zone of a policy whose IP filter is on (the filter starts with
 * it): how many members are ready and how many need attention, or that nothing is computed yet, with a button that
 * opens the addresses per member. Nothing is drawn (nor read) when the filter is off, unknown to the orchestrator, or a
 * zone is enforced already. The policy is the tab's own read (same SWR key).
 */
export default function IPFilterEnforceLine({ connectionId, clusterName }: Readonly<Props>) {
  const t = useTranslations('microsegPilot.ipFilter')
  const { data: policy } = useMicrosegPolicy(connectionId)
  const first = policy?.policy?.ip_filter === true && !policy.zones.some(z => z.state === 'enforce')
  const ids = useMemo(() => {
    if (!first || !policy) return NO_CLUSTERS
    const linked = (policy.clusters ?? []).map(c => c.connection_id)
    return linked.length > 0 ? linked : [connectionId]
  }, [first, policy, connectionId])
  const reads = useMergedClusters(ids, useFilterOnce)
  const [details, setDetails] = useState(false)
  if (!first) return null

  // A cluster that cannot be read (outside the user's scope) adds nothing; one that has not run yet neither.
  const computed = ids.flatMap(id => {
    const data = id in reads.errors ? undefined : reads.byCluster[id]
    return data?.computed ? [data] : []
  })
  const counts = ipFilterCounts(computed.flatMap(d => d.guests))
  const text = computed.length > 0 ? t('enforce.summary', { ready: counts.ready, attention: counts.attention }) : t('enforce.notComputed')

  return (
    <>
      <Box data-testid='ipfilter-enforce-line' sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <Box component='i' aria-hidden className={counts.attention > 0 || computed.length === 0 ? 'ri-alert-line' : 'ri-shield-check-line'} sx={{ fontSize: 18, flexShrink: 0, color: counts.attention > 0 || computed.length === 0 ? 'warning.main' : 'success.main' }} />
        <TruncatedText text={text} sx={{ flex: '1 1 0', minWidth: 0 }} />
        <Button size='small' variant='outlined' disabled={computed.length === 0} onClick={() => setDetails(true)} sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{t('details.button')}</Button>
      </Box>
      {details && <IPFilterDetailsDialog connectionId={connectionId} clusterIds={ids} clusterName={clusterName} onClose={() => setDetails(false)} />}
    </>
  )
}
