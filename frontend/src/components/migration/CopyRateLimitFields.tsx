'use client'

// The copy rate cap of a migration or a batch (lib/migration/warm/copy-rate),
// one setting per line: the cap, an optional time window it applies in, and
// the cap outside that window. The window's hours are the operator's: they
// are kept with the browser's time zone.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Box, FormControlLabel, Stack, Switch, TextField, Tooltip, Typography } from '@mui/material'

import type { CopyRateLimit } from '@/lib/migration/warm/copy-rate'

import CopyRateLimitField from './CopyRateLimitField'

const DEFAULT_WINDOW = { from: '08:00', to: '19:00', offHoursMbps: 0 }

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export default function CopyRateLimitFields({ value, onChange, shared, disabled, onValidityChange }: Readonly<{
  value: CopyRateLimit | null
  /** Null = no cap at all. */
  onChange: (value: CopyRateLimit | null) => void
  /** The cap is a batch's: say it is shared by its VMs. */
  shared?: boolean
  disabled?: boolean
  /** Told whether every field holds a cap; the caller must not submit while one does not. */
  onValidityChange?: (valid: boolean) => void
}>) {
  const t = useTranslations()
  const [invalid, setInvalid] = useState<Record<string, boolean>>({})
  const track = (key: string) => (valid: boolean) => {
    setInvalid(prev => {
      const next = { ...prev, [key]: !valid }
      onValidityChange?.(!Object.values(next).some(Boolean))
      return next
    })
  }
  const mbps = value?.mbps ?? 0
  const schedule = value?.schedule

  const setMbps = (next: number) => onChange(next > 0 || schedule ? { mbps: next, ...(schedule && { schedule }) } : null)
  const setSchedule = (patch: Partial<NonNullable<CopyRateLimit['schedule']>>) => {
    if (!schedule) return
    onChange({ mbps, schedule: { ...schedule, ...patch } })
  }
  const toggle = (on: boolean) => {
    if (on) onChange({ mbps, schedule: { ...DEFAULT_WINDOW, tz: browserTimeZone() } })
    else onChange(mbps > 0 ? { mbps } : null)
  }

  return (
    <Stack spacing={1.5} data-testid="copy-rate-fields">
      <Box>
        <CopyRateLimitField
          label={t('copyRate.label')}
          value={mbps}
          onChange={setMbps}
          help={t('copyRate.help')}
          testId="copy-rate"
          disabled={disabled}
          onValidityChange={track('cap')}
        />
        {shared && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 0.5 }}>{t('copyRate.sharedHelp')}</Typography>
        )}
      </Box>
      {/* The window switch reads like the other switches of the dialog. */}
      <Box data-testid="copy-rate-schedule-row" sx={{ px: 0.5 }}>
        <FormControlLabel
          sx={{ mr: 0 }}
          control={<Switch checked={!!schedule} disabled={disabled} onChange={e => toggle(e.target.checked)} slotProps={{ input: { 'data-testid': 'copy-rate-schedule' } as any }} />}
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Typography variant="body2">{t('copyRate.schedule')}</Typography>
              {schedule && (
                <Tooltip title={t('copyRate.timeZone', { tz: schedule.tz })} arrow placement="top">
                  <i className="ri-time-zone-line" data-testid="copy-rate-tz" aria-label={t('copyRate.timeZone', { tz: schedule.tz })} style={{ fontSize: 14, opacity: 0.6 }} />
                </Tooltip>
              )}
            </Box>
          }
        />
      </Box>
      {schedule && (
        <>
          <Box sx={{ display: 'flex', gap: 2, px: 0.5 }}>
            <TextField
              size="small" type="time" label={t('copyRate.from')} disabled={disabled} value={schedule.from}
              onChange={e => e.target.value && setSchedule({ from: e.target.value })}
              sx={{ flex: 1, minWidth: 0 }}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { 'aria-label': t('copyRate.from'), 'data-testid': 'copy-rate-from' } }}
            />
            <TextField
              size="small" type="time" label={t('copyRate.to')} disabled={disabled} value={schedule.to}
              onChange={e => e.target.value && setSchedule({ to: e.target.value })}
              sx={{ flex: 1, minWidth: 0 }}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { 'aria-label': t('copyRate.to'), 'data-testid': 'copy-rate-to' } }}
            />
          </Box>
          <CopyRateLimitField
            label={t('copyRate.offHours')}
            value={schedule.offHoursMbps}
            onChange={v => setSchedule({ offHoursMbps: v })}
            testId="copy-rate-off-hours"
            disabled={disabled}
            onValidityChange={track('offHours')}
          />
        </>
      )}
    </Stack>
  )
}
