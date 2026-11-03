'use client'

import { Chip, Stack, Typography, alpha } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { FirewallMode } from '@/lib/api/firewall'

import DashboardStateCard, { STATE_AMBER, STATE_GREEN, STATE_GREY, STATE_RED, StateRow } from './DashboardStateCard'

type Props = {
  phase: 'loading' | 'ready' | 'unavailable'
  firewallMode: FirewallMode
  firewallOn: boolean
  /** The emergency stop of the micro-segmentation holds it off. */
  stopHoldsFirewall: boolean
  policyIn: string
  policyOut: string
  rules: number
  groups: number
  /** Opens Firewalling > Cluster. */
  onOpen: () => void
}

const policyColor = (policy: string) => (policy === 'DROP' ? STATE_GREEN : STATE_AMBER)

const chipSx = (color: string) => ({ height: 22, fontSize: 11, fontWeight: 700, bgcolor: alpha(color, 0.18), color, '& .MuiChip-icon': { color: 'inherit' } })

/**
 * The cluster firewall, one of the three state cards of the Dashboard: on or off (or held off by the emergency stop),
 * the default policies, how many rules and security groups. Read from the firewall data the page already loads: no
 * call of its own.
 */
export default function ClusterFirewallCard({ phase, firewallMode, firewallOn, stopHoldsFirewall, policyIn, policyOut, rules, groups, onOpen }: Props) {
  const t = useTranslations('networkPage.dashboard')
  const title = firewallMode === 'cluster' ? t('clusterTitle') : t('hostTitle')

  let accent = STATE_GREY
  if (phase === 'ready') {
    if (!firewallOn) accent = STATE_RED
    else accent = policyIn === 'DROP' ? STATE_GREEN : STATE_AMBER
  }

  let state: React.ReactNode
  if (stopHoldsFirewall) state = <Chip size='small' color='error' label={t('stopHeldTitle')} sx={{ maxWidth: '100%' }} data-testid='cluster-state' />
  else {
    state = (
      <Chip
        size='small'
        data-testid='cluster-state'
        icon={<i className={firewallOn ? 'ri-shield-check-line' : 'ri-shield-cross-line'} style={{ fontSize: 14 }} />}
        label={firewallOn ? t('firewallOn') : t('firewallOff')}
        sx={chipSx(firewallOn ? STATE_GREEN : STATE_RED)}
      />
    )
  }

  return (
    <DashboardStateCard
      testId='cluster-card'
      icon='ri-server-line'
      title={title}
      accent={accent}
      onOpen={onOpen}
      openLabel={t('open')}
      openAriaLabel={t('openCluster')}
      loading={phase === 'loading'}
    >
      {phase === 'unavailable' ? (
        <Typography variant='body2' color='text.secondary'>{t('clusterUnavailable')}</Typography>
      ) : (
        <Stack spacing={1.25}>
          <StateRow label={t('stateLabel')}>{state}</StateRow>
          <StateRow label={t('policiesLabel')}>
            <Stack direction='row' spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              <Chip size='small' icon={<i className='ri-arrow-down-line' style={{ fontSize: 14 }} />} label={`IN: ${policyIn}`} sx={chipSx(policyColor(policyIn))} />
              <Chip size='small' icon={<i className='ri-arrow-up-line' style={{ fontSize: 14 }} />} label={`OUT: ${policyOut}`} sx={chipSx(STATE_GREY)} />
            </Stack>
          </StateRow>
          <StateRow label={t('rulesLabel')}>
            <Typography variant='body2' data-testid='cluster-rules'>{t('rulesCount', { rules, groups })}</Typography>
          </StateRow>
        </Stack>
      )}
    </DashboardStateCard>
  )
}
