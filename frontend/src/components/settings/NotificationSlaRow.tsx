'use client'

import type { ReactNode } from 'react'

import { useTranslations } from 'next-intl'
import { Box, FormControl, FormControlLabel, InputAdornment, InputLabel, MenuItem, Select, Switch } from '@mui/material'

import { SMALL_SELECT_SX } from '@/components/settings/destinations/DestinationDialogParts'
import NotificationCategoryHelp from '@/components/settings/NotificationCategoryHelp'
import NumericTextField from '@/components/ui/NumericTextField'

/** The periods a policy budget is measured over, as the orchestrator names them. */
export const SLA_PERIODS = ['month', 'rolling30'] as const
export type SlaPeriod = (typeof SLA_PERIODS)[number]

/** The SLA fields of the notification settings. */
export interface SlaNotificationSettings {
  enable_sla?: boolean
  sla_budget_warn_percent?: number
  sla_period?: SlaPeriod
}

export const DEFAULT_SLA_WARN_PERCENT = 80

interface Props {
  settings: SlaNotificationSettings
  onChange: (patch: SlaNotificationSettings) => void
  /** The severity picker of the `sla` category, as every category has one. */
  severity: ReactNode
}

/**
 * The SLA category of the notification settings: the policies that spend
 * their downtime budget, past which share of it, over which period.
 */
export default function NotificationSlaRow({ settings, onChange, severity }: Readonly<Props>) {
  const t = useTranslations('notifications.sla')
  const enabled = settings.enable_sla ?? true

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
      <FormControlLabel
        sx={{ minWidth: 240, mr: 0 }}
        control={<Switch checked={enabled} onChange={e => onChange({ enable_sla: e.target.checked })} />}
        label={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className='ri-heart-pulse-line' style={{ color: '#ec4899' }} aria-hidden='true' />
            {t('title')}
            <NotificationCategoryHelp text={`${t('description')} ${t('alertsNote')}`} />
          </Box>
        }
      />
      {enabled && (
        <>
          {severity}
          <FormControl size='small' sx={{ minWidth: 200 }}>
            <InputLabel id='sla-period-label'>{t('period')}</InputLabel>
            <Select
              labelId='sla-period-label'
              label={t('period')}
              value={settings.sla_period ?? 'month'}
              onChange={e => onChange({ sla_period: e.target.value as SlaPeriod })}
              sx={SMALL_SELECT_SX}
            >
              {SLA_PERIODS.map(p => <MenuItem key={p} value={p}>{t(`periods.${p}`)}</MenuItem>)}
            </Select>
          </FormControl>
          <NumericTextField
            size='small'
            type='number'
            label={t('warnPercent')}
            value={settings.sla_budget_warn_percent ?? DEFAULT_SLA_WARN_PERCENT}
            onChange={v => onChange({ sla_budget_warn_percent: v })}
            fallback={DEFAULT_SLA_WARN_PERCENT}
            min={1}
            max={99}
            sx={{ width: 200 }}
            slotProps={{ input: { endAdornment: <InputAdornment position='end'>%</InputAdornment> } }}
          />
        </>
      )}
    </Box>
  )
}
