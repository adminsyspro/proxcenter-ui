'use client'

import { useState } from 'react'
import { Box, Chip, IconButton, Popover, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { MicrosegCluster } from '@/lib/microseg/types'

import ClusterChip from './ClusterChip'
import ConnectionGlyph, { useConnectionKind } from './ConnectionGlyph'
import { shownClusterName } from './ClusterRunRow'
import { FormRow, ONE_LINE_SX } from './dialogParts'
import { SETTINGS_LABEL_WIDTH } from './SettingsFields'
import { associateBlock } from './settingsModel'
import { WriteTip, useMicrosegWrite } from './microsegAccess'

/**
 * Chips shown on the line, so each keeps the room for its name: both clusters of a pair, the first one of a larger
 * group; the others are behind the "+N" chip, so the line never wraps.
 */
export const VISIBLE_CLUSTER_CHIPS = 2
export const visibleChips = (count: number) => (count > VISIBLE_CLUSTER_CHIPS ? 1 : count)

type Cluster = Pick<MicrosegCluster, 'connection_id' | 'active'>

type Props = {
  /** The tab's connection: always named, even when the lookup has no name for it. */
  connectionId: string
  clusters: Cluster[]
  /** The most clusters a policy takes, from GET clusters; unknown until it answers. */
  max?: number
  /** How many connections can still join the group. */
  candidateCount: number
  clusterName: (id: string) => string
  busy?: boolean
  onAdd: () => void
  onRemove: (id: string) => void
}

type RowProps = { cluster: Cluster; name: string; pendingText: string; removeLabel?: string; onRemove?: () => void }

/** A cluster in the list of the "+N" chip: its glyph, name (and its pending note), remove icon, on one line. */
function ClusterRow({ cluster, name, pendingText, removeLabel, onRemove }: Readonly<RowProps>) {
  const kind = useConnectionKind(cluster.connection_id)
  return (
    <Box data-testid='associated-cluster-row' sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, px: 1.5, minHeight: 36 }}>
      <ConnectionGlyph kind={kind} />
      <Typography variant='body2' title={cluster.active ? name : `${name} · ${pendingText}`} sx={{ ...ONE_LINE_SX, flex: 1, minWidth: 0 }}>
        {name}
        {cluster.active ? null : <Box component='span' sx={{ ml: 1, color: 'text.secondary' }}>{pendingText}</Box>}
      </Typography>
      {onRemove ? (
        <IconButton size='small' aria-label={removeLabel} onClick={onRemove} sx={{ flexShrink: 0 }}>
          <i className='ri-close-line' />
        </IconButton>
      ) : null}
    </Box>
  )
}

/**
 * The "Associated clusters" line of the Settings, always on one line: the chips of the clusters sharing the policy
 * (both of a pair, the first of a larger group; an inactive one carries a clock), a "+N" chip naming the others in
 * its tooltip, then the add button, disabled with the reason at the maximum or without a connection to propose. A
 * click on a chip of a shared policy opens the list of every cluster, in full, each with its remove icon: a cluster
 * can be removed only while the policy has two or more. A cluster outside the user's scope is named in general words,
 * never by its ID, and has no remove action (the relay would refuse it).
 */
export default function AssociatedClustersLine({ connectionId, clusters, max, candidateCount, clusterName, busy = false, onAdd, onRemove }: Readonly<Props>) {
  const t = useTranslations('microsegPilot.settings.clusters')
  const tAll = useTranslations()
  const { canWrite } = useMicrosegWrite()
  const [listAnchor, setListAnchor] = useState<HTMLElement | null>(null)
  const removable = canWrite && !busy && clusters.length > 1
  const other = tAll('microsegPilot.plan.cluster.other')
  const nameOf = (id: string) => shownClusterName(id, connectionId, clusterName, other)
  const visible = (id: string) => shownClusterName(id, connectionId, clusterName) !== null
  const block = associateBlock(clusters.length, max, candidateCount)
  let blockText: string | undefined
  if (block === 'max') blockText = t('maxReached', { max: max ?? 0 })
  else if (block === 'none') blockText = t('noCandidate')

  const shown = clusters.slice(0, visibleChips(clusters.length))
  const hidden = clusters.slice(shown.length)
  // The list opens under the line, from any chip of a shared policy: the names in full and the remove icons are there.
  const openList = (e: { currentTarget: HTMLElement }) => setListAnchor(e.currentTarget.closest<HTMLElement>('[data-testid="associated-clusters"]') ?? e.currentTarget)
  const remove = (id: string) => {
    setListAnchor(null)
    onRemove(id)
  }

  return (
    <FormRow label={t('row')} tip={t('hint')} labelWidth={SETTINGS_LABEL_WIDTH}>
      <Box data-testid='associated-clusters' sx={{ display: 'flex', alignItems: 'center', flexWrap: 'nowrap', gap: 1, minWidth: 0, overflow: 'hidden' }}>
        {shown.map(c => {
          const name = nameOf(c.connection_id)
          return (
            <Box key={c.connection_id} sx={{ minWidth: 0, flexShrink: 1, display: 'flex' }}>
              <ClusterChip
                connectionId={c.connection_id}
                name={name}
                note={c.active ? undefined : t('pending')}
                noteIcon
                onClick={clusters.length > 1 ? openList : undefined}
              />
            </Box>
          )
        })}
        {hidden.length > 0 && (
          <Tooltip describeChild title={hidden.map(c => nameOf(c.connection_id)).join(', ')}>
            <Chip
              size='small'
              label={`+${hidden.length}`}
              aria-haspopup='true'
              aria-expanded={listAnchor ? 'true' : 'false'}
              onClick={openList}
              sx={{ flexShrink: 0 }}
            />
          </Tooltip>
        )}
        <WriteTip title={blockText}>
          <IconButton size='small' aria-label={t('add')} disabled={!canWrite || busy || block !== null} onClick={onAdd} sx={{ flexShrink: 0 }}>
            <i className='ri-add-line' />
          </IconButton>
        </WriteTip>
      </Box>
      <Popover
        open={!!listAnchor}
        anchorEl={listAnchor}
        onClose={() => setListAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { py: 0.5, minWidth: 240, maxWidth: 400 } } }}
      >
        {clusters.map(c => {
          const name = nameOf(c.connection_id)
          const canRemove = removable && visible(c.connection_id)
          return (
            <ClusterRow
              key={c.connection_id}
              cluster={c}
              name={name}
              pendingText={t('pending')}
              removeLabel={canRemove ? t('removeLabel', { name }) : undefined}
              onRemove={canRemove ? () => remove(c.connection_id) : undefined}
            />
          )
        })}
      </Popover>
    </FormRow>
  )
}
