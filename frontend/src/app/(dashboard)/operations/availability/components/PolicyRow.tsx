'use client'

import { useState } from 'react'

import { useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Collapse,
  IconButton,
  LinearProgress,
  TableCell,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'

import { usePolicyDetail } from '../hooks/useSlaLists'

import { useAvailabilityFormat } from './availabilityFormat'
import { policyStatus, type PolicyItem, type PolicyStatus } from './slaApi'
import PolicyGuests from './PolicyGuests'

const STATUS_COLOR: Record<PolicyStatus, 'success' | 'warning' | 'error' | 'default'> = {
  met: 'success',
  atRisk: 'warning',
  violated: 'error',
  unmeasured: 'default',
}

/** Number of columns of the policies table, the detail row spans them all. */
export const POLICY_COLUMNS = 9

// Scope chips shown before folding the rest into a "+n" chip.
const SHOWN_LABELS = 2

interface Props {
  policy: PolicyItem
  canManage: boolean
  onEdit: (policy: PolicyItem) => void
  onDelete: (policy: PolicyItem) => void
  /** Opens the measured connections; unset for whoever may not change them. */
  onConfigure?: () => void
}

/** A value with a thin bar under it, as in the overview cards. */
function Measure({ text, value, color }: Readonly<{ text: string; value: number; color: 'success' | 'warning' | 'error' | 'primary' }>) {
  return (
    <Box sx={{ minWidth: 96 }}>
      <Typography variant='body2' noWrap>{text}</Typography>
      <LinearProgress variant='determinate' value={Math.min(100, Math.max(0, value))} color={color} sx={{ height: 4, borderRadius: 2, mt: 0.5 }} />
    </Box>
  )
}

/** What the policy selects: the tags, the pools and the ticked guests. */
function ScopeChips({ policy }: Readonly<{ policy: PolicyItem }>) {
  const t = useTranslations('availability')
  const labels = [
    ...policy.tags.map(v => ({ key: `tag:${v}`, icon: 'ri-price-tag-3-line', label: v })),
    ...policy.pools.map(v => ({ key: `pool:${v}`, icon: 'ri-folder-line', label: v })),
  ]
  const hidden = labels.slice(SHOWN_LABELS)

  if (labels.length === 0 && policy.guests.length === 0) {
    return <Typography variant='body2' color='text.secondary'>{t('policies.noScope')}</Typography>
  }

  return (
    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'nowrap', overflow: 'hidden' }}>
      {policy.guests.length > 0 && (
        <Chip size='small' variant='outlined' icon={<i className='ri-computer-line' />} label={t('policies.guestCount', { count: policy.guests.length })} />
      )}
      {labels.slice(0, SHOWN_LABELS).map(l => (
        <Chip key={l.key} size='small' variant='outlined' icon={<i className={l.icon} />} label={l.label} />
      ))}
      {hidden.length > 0 && (
        <Tooltip title={hidden.map(l => l.label).join(', ')}>
          <Chip size='small' variant='outlined' label={`+${hidden.length}`} />
        </Tooltip>
      )}
    </Box>
  )
}

/** A policy on one table row; the chevron opens the list of its guests under it. */
export default function PolicyRow({ policy, canManage, onEdit, onDelete, onConfigure }: Readonly<Props>) {
  const t = useTranslations('availability')
  const { rate, target, span } = useAvailabilityFormat()
  const [open, setOpen] = useState(false)
  const { data, error, isLoading } = usePolicyDetail(open ? policy.id : null)
  const status = policyStatus(policy.summary, policy.target)
  const availability = policy.summary?.availability ?? null
  // A policy with nothing measured has no budget and no guest to rank yet.
  const budget = availability === null ? null : policy.summary?.budget ?? null
  const belowTarget = availability === null ? undefined : policy.summary?.below_target
  const barColor = STATUS_COLOR[status] === 'default' ? 'primary' : STATUS_COLOR[status]

  let detail
  if (error) detail = <Alert severity='warning'>{t('error.generic')}</Alert>
  else if (isLoading || !data) detail = <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={20} aria-label={t('loading')} /></Box>
  else if (data.results.length === 0) detail = <Typography variant='body2' color='text.secondary'>{t('policies.noGuests')}</Typography>
  else detail = <PolicyGuests guests={data.results} connectionNames={data.connectionNames ?? {}} target={policy.target} to={data.to} />

  return (
    <>
      <TableRow hover sx={{ '& > td': { borderBottom: open ? 0 : undefined } }}>
        <TableCell padding='checkbox'>
          <IconButton size='small' aria-expanded={open} aria-label={t(open ? 'policies.hideGuests' : 'policies.showGuests', { name: policy.name })} onClick={() => setOpen(o => !o)}>
            <i className={open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} />
          </IconButton>
        </TableCell>
        <TableCell sx={{ maxWidth: 260 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            <i className='ri-shield-check-line' aria-hidden='true' />
            <Typography variant='body2' noWrap sx={{ fontWeight: 500 }}>{policy.name}</Typography>
            {!policy.enabled && <Chip size='small' variant='outlined' label={t('policies.disabled')} />}
          </Box>
        </TableCell>
        <TableCell sx={{ maxWidth: 280 }}><ScopeChips policy={policy} /></TableCell>
        <TableCell><Chip size='small' color={STATUS_COLOR[status]} label={t(`policies.status.${status}`)} /></TableCell>
        <TableCell><Typography variant='body2' noWrap>{target(policy.target)}</Typography></TableCell>
        <TableCell>
          {availability === null
            ? <Typography variant='body2' color='text.secondary'>{t('connection.notMeasured')}</Typography>
            : <Measure text={rate(availability)} value={availability} color={barColor} />}
        </TableCell>
        <TableCell>
          {budget
            ? (
              <Measure
                text={t('policies.budgetUsage', { used: span(budget.used_seconds), allowed: span(budget.allowed_seconds) })}
                value={budget.allowed_seconds > 0 ? (budget.used_seconds / budget.allowed_seconds) * 100 : 100}
                color={barColor}
              />
            )
            : <Typography variant='body2' color='text.secondary'>-</Typography>}
        </TableCell>
        <TableCell>
          <Typography variant='body2' noWrap>{t('policies.guestCount', { count: policy.guestCount })}</Typography>
          {belowTarget !== undefined && belowTarget > 0 && (
            <Typography variant='caption' color='error.main' noWrap sx={{ display: 'block' }}>{t('policies.belowTarget', { count: belowTarget })}</Typography>
          )}
          {(policy.unmeasuredGuests ?? 0) > 0 && (
            <Tooltip describeChild title={t(onConfigure ? 'policies.unmeasuredHint' : 'policies.unmeasuredHintAsk')}>
              <Chip
                size='small'
                color='warning'
                variant='outlined'
                icon={<i className='ri-eye-off-line' aria-hidden='true' />}
                label={t('policies.unmeasured', { count: policy.unmeasuredGuests ?? 0 })}
                onClick={onConfigure}
                sx={{ mt: 0.5 }}
              />
            </Tooltip>
          )}
        </TableCell>
        <TableCell align='right' sx={{ whiteSpace: 'nowrap' }}>
          {canManage && (
            <>
              <Tooltip title={t('common.edit')}>
                <IconButton size='small' aria-label={`${t('common.edit')} ${policy.name}`} onClick={() => onEdit(policy)}>
                  <i className='ri-edit-line' />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('common.delete')}>
                <IconButton size='small' aria-label={`${t('common.delete')} ${policy.name}`} onClick={() => onDelete(policy)}>
                  <i className='ri-delete-bin-line' />
                </IconButton>
              </Tooltip>
            </>
          )}
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={POLICY_COLUMNS} sx={{ py: 0, ...(open ? {} : { borderBottom: 0 }) }}>
          <Collapse in={open} unmountOnExit>
            <Box sx={{ py: 1.5, pl: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>{detail}</Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  )
}
