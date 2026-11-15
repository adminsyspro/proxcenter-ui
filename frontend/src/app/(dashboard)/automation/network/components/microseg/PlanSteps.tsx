'use client'

import { useState, type ReactNode } from 'react'
import { Box, ButtonBase, Chip, CircularProgress, Collapse, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { StatusIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'

import type { GuestRef, PlanStep } from '@/lib/microseg/types'

import PolicyPager, { usePaged } from './PolicyPager'
import { findGuest, groupPlanSteps, guestKey } from './planGroups'
import { groupState, type StepState } from './planStepStates'
import type { PolicyGuest } from './zoneModel'
import TruncatedText from './TruncatedText'

export const GUESTS_PER_PAGE = 20

type States = ReadonlyMap<number, StepState>

const STATE_ICON: Record<Exclude<StepState, 'running'>, { icon: string; color: string }> = {
  done: { icon: 'ri-check-line', color: 'success.main' },
  failed: { icon: 'ri-close-line', color: 'error.main' },
  notRun: { icon: 'ri-subtract-line', color: 'text.disabled' },
  waiting: { icon: 'ri-checkbox-blank-circle-line', color: 'text.disabled' },
}

/** Where a step (or a group of steps) stands while the plan is applied: a check once done, a spinner while written. */
export function StepMark({ state }: { state: StepState }) {
  const t = useTranslations('microsegPilot.plan.stepState')
  const label = t(state)
  if (state === 'running') {
    return <Box component='span' role='img' aria-label={label} data-step-state={state} sx={{ display: 'inline-flex', width: 18, justifyContent: 'center', flexShrink: 0 }}><CircularProgress size={14} /></Box>
  }
  const { icon, color } = STATE_ICON[state]
  return <Box component='i' role='img' aria-label={label} data-step-state={state} className={icon} sx={{ width: 18, textAlign: 'center', fontSize: state === 'waiting' ? 10 : 18, lineHeight: 1, color, flexShrink: 0 }} />
}

/** One step on one line: where it stands while applied, what it does, and why it failed or did not run when the step carries a reason. */
function StepLine({ step, state }: { step: PlanStep; state?: StepState }) {
  const full = step.error ? `${step.summary}: ${step.error}` : step.summary
  return (
    <Tooltip title={full}>
      <Box data-testid={`plan-step-${step.index}`} sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, minHeight: 28, pl: state ? 2.5 : 5 }}>
        {state && <StepMark state={state} />}
        <Typography noWrap variant='body2' sx={{ flex: '0 1 auto', minWidth: 0 }}>{step.summary}</Typography>
        {step.error && <Typography noWrap variant='body2' color='error' sx={{ flex: '1 1 0', minWidth: 0 }}>{step.error}</Typography>}
      </Box>
    </Tooltip>
  )
}

type GroupProps = { header: ReactNode; count: number; steps: PlanStep[]; defaultOpen?: boolean; label: string; states?: States | null }

/** A collapsible group: a header on one line (chevron, glyph, name, step count), the steps under it. */
function StepGroup({ header, count, steps, defaultOpen = false, label, states }: GroupProps) {
  const t = useTranslations('microsegPilot.plan')
  const [open, setOpen] = useState(defaultOpen)
  // While the plan is applied: where the group stands, and how many of its steps are done.
  const group = states ? groupState(steps, states) : null
  return (
    <Box role='listitem' aria-label={label} sx={{ borderBottom: 1, borderColor: 'divider' }}>
      <ButtonBase
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        sx={{ display: 'flex', width: '100%', justifyContent: 'flex-start', alignItems: 'center', gap: 1, minHeight: 40, px: 1, textAlign: 'left', minWidth: 0 }}
      >
        <i className={open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} />
        {header}
        {group && <Box sx={{ ml: 'auto', display: 'inline-flex', flexShrink: 0 }}><StepMark state={group.state} /></Box>}
        <Chip size='small' variant='outlined' label={group ? `${group.done} / ${count}` : t('stepCount', { count })} sx={{ flexShrink: 0, ml: group ? 0 : 'auto' }} />
      </ButtonBase>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ pb: 1 }}>{steps.map(step => <StepLine key={step.index} step={step} state={states?.get(step.index)} />)}</Box>
      </Collapse>
    </Box>
  )
}

function GuestHeader({ guest, inventory }: { guest: GuestRef; inventory: PolicyGuest | undefined }) {
  const name = inventory?.name ?? `${guest.type}/${guest.vmid}`
  return (
    <>
      {inventory
        ? <StatusIcon type='vm' vmType={inventory.type} status={inventory.status} />
        : <i className='ri-question-line' style={{ opacity: 0.6 }} />}
      <TruncatedText text={name} fontWeight={600} sx={{ flex: '0 1 auto' }} />
      <Typography noWrap variant='body2' color='text.secondary' sx={{ flex: '1 1 0', minWidth: 0 }}>{`${guest.vmid} · ${guest.node}`}</Typography>
    </>
  )
}

type Props = {
  steps: PlanStep[]
  guests: PolicyGuest[]
  /** Where each step stands (by step index) while the plan is applied and once it has been; absent on a plan not applied. */
  states?: States | null
}

/**
 * Steps of a plan (or of an outcome) grouped as the cluster objects first, then one group per guest, paginated. With
 * `states`, each step and each group carries its mark: a check once written, a spinner while it is, a cross on a failure.
 */
export default function PlanSteps({ steps, guests, states }: Props) {
  const t = useTranslations('microsegPilot.plan')
  const { cluster, byGuest } = groupPlanSteps(steps)
  const paged = usePaged(byGuest, GUESTS_PER_PAGE)

  return (
    <Box>
      <Box role='list'>
        {cluster.length > 0 && (
          <StepGroup
            label={t('clusterGroup')}
            header={<><i className='ri-server-line' /><Typography noWrap fontWeight={600}>{t('clusterGroup')}</Typography></>}
            count={cluster.length}
            steps={cluster}
            defaultOpen
            states={states}
          />
        )}
        {paged.rows.map(group => {
          const inventory = findGuest(guests, group.guest)
          return (
            <StepGroup
              key={guestKey(group.guest)}
              label={inventory?.name ?? `${group.guest.type}/${group.guest.vmid}`}
              header={<GuestHeader guest={group.guest} inventory={inventory} />}
              count={group.steps.length}
              steps={group.steps}
              states={states}
            />
          )
        })}
      </Box>
      <PolicyPager count={paged.count} page={paged.page} size={paged.size} onPage={paged.setPage} />
    </Box>
  )
}
