'use client'

import { useState, type ReactNode } from 'react'
import { Box, ButtonBase, Chip, Collapse, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { StatusIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'

import type { GuestRef, PlanStep } from '@/lib/microseg/types'

import PolicyPager, { usePaged } from './PolicyPager'
import { findGuest, groupPlanSteps, guestKey } from './planGroups'
import type { PolicyGuest } from './zoneModel'

export const GUESTS_PER_PAGE = 20

/** One step on one line: what it does, and why it failed or did not run when the step carries a reason. */
function StepLine({ step }: { step: PlanStep }) {
  const full = step.error ? `${step.summary}: ${step.error}` : step.summary
  return (
    <Tooltip title={full}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, minHeight: 28, pl: 5 }}>
        <Typography noWrap variant='body2' sx={{ flex: '0 1 auto', minWidth: 0 }}>{step.summary}</Typography>
        {step.error && <Typography noWrap variant='body2' color='error' sx={{ flex: '1 1 0', minWidth: 0 }}>{step.error}</Typography>}
      </Box>
    </Tooltip>
  )
}

type GroupProps = { header: ReactNode; count: number; steps: PlanStep[]; defaultOpen?: boolean; label: string }

/** A collapsible group: a header on one line (chevron, glyph, name, step count), the steps under it. */
function StepGroup({ header, count, steps, defaultOpen = false, label }: GroupProps) {
  const t = useTranslations('microsegPilot.plan')
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Box role='listitem' aria-label={label} sx={{ borderBottom: 1, borderColor: 'divider' }}>
      <ButtonBase
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        sx={{ display: 'flex', width: '100%', justifyContent: 'flex-start', alignItems: 'center', gap: 1, minHeight: 40, px: 1, textAlign: 'left', minWidth: 0 }}
      >
        <i className={open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} />
        {header}
        <Chip size='small' variant='outlined' label={t('stepCount', { count })} sx={{ flexShrink: 0, ml: 'auto' }} />
      </ButtonBase>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ pb: 1 }}>{steps.map(step => <StepLine key={step.index} step={step} />)}</Box>
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
      <Tooltip title={name}><Typography noWrap fontWeight={600} sx={{ flex: '0 1 auto' }}>{name}</Typography></Tooltip>
      <Typography noWrap variant='body2' color='text.secondary' sx={{ flex: '1 1 0', minWidth: 0 }}>{`${guest.vmid} · ${guest.node}`}</Typography>
    </>
  )
}

type Props = { steps: PlanStep[]; guests: PolicyGuest[] }

/** Steps of a plan (or of an outcome) grouped as the cluster objects first, then one group per guest, paginated. */
export default function PlanSteps({ steps, guests }: Props) {
  const t = useTranslations('microsegPilot.plan')
  const { cluster, byGuest } = groupPlanSteps(steps)
  const paged = usePaged(byGuest, GUESTS_PER_PAGE)

  return (
    <Box role='list'>
      {cluster.length > 0 && (
        <StepGroup
          label={t('clusterGroup')}
          header={<><i className='ri-server-line' /><Typography noWrap fontWeight={600}>{t('clusterGroup')}</Typography></>}
          count={cluster.length}
          steps={cluster}
          defaultOpen
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
          />
        )
      })}
      <PolicyPager count={paged.count} page={paged.page} size={paged.size} onPage={paged.setPage} />
    </Box>
  )
}
