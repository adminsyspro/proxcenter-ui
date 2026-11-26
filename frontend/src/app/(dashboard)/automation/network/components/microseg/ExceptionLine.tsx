'use client'

import { Box, Chip, IconButton, Tooltip } from '@mui/material'
import { useTranslations } from 'next-intl'

import { StatusIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'
import type { ZoneState } from '@/lib/microseg/types'

import ClusterChip from './ClusterChip'
import DiffChip from './DiffChip'
import { useExceptionServiceName } from './ExceptionDialog'
import { draftException, exceptionLabel, exceptionStatus, shownExceptionStatus, type ExceptionDraft, type ExceptionIssue, type ExceptionStatus } from './exceptionModel'
import { LIST_ROW_SX } from './PanelSection'
import TruncatedText from './TruncatedText'
import { guestKey, type PolicyGuest, type ZoneMember } from './zoneModel'

/** The colour of each status a list says. */
export const EXCEPTION_STATUS_COLOR: Record<ExceptionIssue, 'default' | 'warning' | 'info'> = {
  inactive_zone: 'default', no_destination: 'warning', missing_guest: 'warning', waiting_address: 'info', renamed: 'warning',
}

/** The icon of a guest an exception names (QEMU or LXC, in the colour of its state), a question mark for one the inventory does not have. */
export function ExceptionGuestIcon({ guest }: { guest: PolicyGuest | undefined }) {
  return (
    <Box component='span' sx={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
      {guest
        ? <StatusIcon type='vm' vmType={guest.type} status={guest.status} />
        : <i className='ri-question-line' style={{ opacity: 0.6 }} />}
    </Box>
  )
}

/**
 * The status of an exception that is not active, as a chip that never shrinks (its label stays whole: what is next
 * to it gives way); its tooltip says the status again, then explains it. Nothing for an active one, and nothing that
 * reads the guest list while it is unknown (`shownExceptionStatus`).
 */
export function ExceptionStatusChip({ status, guestsKnown = true }: { status: ExceptionStatus; guestsKnown?: boolean }) {
  const t = useTranslations('microsegPilot.policy.exceptions')
  const shown = shownExceptionStatus(status, guestsKnown)
  if (!shown) return null
  return (
    <Tooltip
      title={(
        // The label first, as the title of what explains it.
        <Box component='span' sx={{ display: 'block' }}>
          <Box component='span' data-testid='exception-status-label' sx={{ display: 'block', fontWeight: 700 }}>{t(`status.${shown}`)}</Box>
          <Box component='span' sx={{ display: 'block' }}>{t(`statusHint.${shown}`)}</Box>
        </Box>
      )}
    >
      <Chip size='small' variant='outlined' color={EXCEPTION_STATUS_COLOR[shown]} label={t(`status.${shown}`)} sx={{ flexShrink: 0 }} />
    </Tooltip>
  )
}

type LineProps = {
  exception: ExceptionDraft
  guests: PolicyGuest[]
  members: ZoneMember[]
  /** The state of the zone the exception belongs to: nothing of it is written while the zone is disabled. */
  zoneState: ZoneState
  /** False while the guest list is loading or failed: only the status that does not read it (the zone not applied) is said. */
  guestsKnown?: boolean
  disabled?: boolean
  /** The cluster of the exception, given only on a shared policy: its chip follows the icon. */
  cluster?: { id: string; name: string }
  /**
   * What the draft does to the exception over the last applied revision: `draft` for one it adds or changes (not
   * enforced as shown until the next apply), `removed` for one it no longer has (enforced until the next apply: struck,
   * with nothing to edit).
   */
  mark?: 'draft' | 'removed'
  onEdit: () => void
  onDelete: () => void
}

/**
 * One exception on one line: the icon of its first source, its cluster on a shared policy, "app-01 → db-01 ·
 * PostgreSQL", its status when it is not active, its draft mark, then its edit and its delete. The delete asks
 * nothing: the caller decides what it does. `guests` and `members` are those of the exception's cluster.
 */
export function ExceptionLine({ exception, guests, members, zoneState, guestsKnown = true, disabled = false, cluster, mark, onEdit, onDelete }: LineProps) {
  const t = useTranslations('microsegPilot.policy.exceptions')
  const to = useTranslations('microsegPilot.overview')
  const removed = mark === 'removed'
  const serviceName = useExceptionServiceName()
  const stored = draftException(exception, '')
  const label = exceptionLabel(stored, guests, serviceName)
  const status = exceptionStatus(stored, { state: zoneState }, members, guests)
  const first = exception.sources[0]
  const guest = first ? guests.find(g => guestKey(g) === guestKey(first)) : undefined
  return (
    <Box role='listitem' aria-label={label} sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, ...LIST_ROW_SX }}>
      <ExceptionGuestIcon guest={guest} />
      {cluster && <ClusterChip connectionId={cluster.id} name={cluster.name} compact />}
      <TruncatedText text={label} variant='body2' sx={{ flex: '1 1 0', minWidth: 0 }} struck={removed} />
      {removed && <DiffChip kind='removed' />}
      {mark === 'draft' && (
        <Tooltip title={to('edge.draft')}><Chip size='small' color='warning' variant='outlined' label={to('flowPanel.draft')} sx={{ flexShrink: 0 }} /></Tooltip>
      )}
      {!removed && <ExceptionStatusChip status={status} guestsKnown={guestsKnown} />}
      {!removed && <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <Tooltip title={t('edit')}>
          <span>
            <IconButton size='small' aria-label={t('edit')} disabled={disabled} onClick={onEdit}><i className='ri-pencil-line' /></IconButton>
          </span>
        </Tooltip>
        <Tooltip title={t('delete')}>
          <span>
            <IconButton size='small' aria-label={t('delete')} disabled={disabled} onClick={onDelete}><i className='ri-delete-bin-line' /></IconButton>
          </span>
        </Tooltip>
      </Box>}
    </Box>
  )
}
