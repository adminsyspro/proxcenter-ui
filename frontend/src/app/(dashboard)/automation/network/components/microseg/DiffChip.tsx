'use client'

import { Chip, Tooltip } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { DiffKind } from '@/lib/microseg/pendingChanges'

const COLOR: Record<DiffKind, 'success' | 'warning' | 'error'> = { added: 'success', changed: 'warning', removed: 'error' }
const ICON: Record<DiffKind, string> = { added: 'ri-add-line', changed: 'ri-edit-line', removed: 'ri-subtract-line' }

/** How an item of the draft differs from the last applied revision: added (green), changed (amber), removed (red). */
export default function DiffChip({ kind }: { kind: DiffKind | undefined }) {
  const t = useTranslations('microsegPilot.policy.diff')
  if (!kind) return null
  return (
    <Tooltip title={t(`${kind}Hint`)}>
      <Chip
        size='small'
        color={COLOR[kind]}
        variant='outlined'
        icon={<i className={ICON[kind]} style={{ fontSize: 14 }} />}
        label={t(kind)}
        sx={{ flexShrink: 0 }}
      />
    </Tooltip>
  )
}
