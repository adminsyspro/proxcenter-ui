'use client'

import { useMemo } from 'react'

import { useTranslations } from 'next-intl'

import { Box } from '@mui/material'

import { useChanges } from '@/hooks/useChanges'
import { useGuestStatus } from '@/hooks/useGuestStatus'
import ChangeJournal from '@/components/changes/ChangeJournal'
import EmptyState from '@/components/EmptyState'
import { CardsSkeleton } from '@/components/skeletons'
import type { JournalChange } from '@/lib/changes/journal'

interface ChangeTrackingTabProps {
  connectionId: string
  resourceType?: string   // 'vm' | 'ct' | 'node'
  resourceId?: string     // e.g. "100" for a VM
  node?: string           // node name filter
}

/**
 * The Changes tab of a guest, node or cluster: the journal of the Changes
 * page, narrowed to that resource. A guest's tab drops the resource column,
 * every row being that guest.
 */
export default function ChangeTrackingTab({ connectionId, resourceType, resourceId, node }: ChangeTrackingTabProps) {
  const t = useTranslations()
  const guestStatus = useGuestStatus()
  const { data, isLoading } = useChanges({
    limit: 500,
    connectionId,
    resourceType,
    resourceId,
    node
  })

  const changes: JournalChange[] = useMemo(() => data?.data || [], [data])

  if (isLoading) return <CardsSkeleton count={3} />

  if (changes.length === 0) {
    return (
      <EmptyState
        icon='ri-git-commit-line'
        title={t('changes.noChanges')}
        description={t('changes.noChangesDescription')}
      />
    )
  }

  const single = !!resourceId

  return (
    <Box sx={{ p: 2 }}>
      <ChangeJournal
        changes={changes}
        guestStatus={guestStatus}
        showResource={!single}
        filters={single ? ['family', 'user'] : ['family', 'resourceType', 'user']}
      />
    </Box>
  )
}
