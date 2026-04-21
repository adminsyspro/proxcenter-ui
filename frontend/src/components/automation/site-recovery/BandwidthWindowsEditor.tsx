'use client'

import { useTranslations } from 'next-intl'
import {
  Box, Button, IconButton, MenuItem, Select, Stack, TextField, Tooltip, Typography,
} from '@mui/material'

import type { BandwidthWindow } from '@/lib/orchestrator/site-recovery.types'

interface Props {
  value: BandwidthWindow[]
  onChange: (next: BandwidthWindow[]) => void
  staticRateMbps: number
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

function emptyWindow(): BandwidthWindow {
  return {
    days: [1, 2, 3, 4, 5], // Mon-Fri by default
    start_hour: 8,
    end_hour: 18,
    rate_limit_mbps: 50,
  }
}

export default function BandwidthWindowsEditor({ value, onChange, staticRateMbps }: Props) {
  const t = useTranslations()

  const updateAt = (idx: number, patch: Partial<BandwidthWindow>) => {
    const next = value.slice()
    next[idx] = { ...next[idx], ...patch }
    onChange(next)
  }

  const toggleDay = (idx: number, day: number) => {
    const w = value[idx]
    const has = w.days.includes(day)
    const days = has ? w.days.filter(d => d !== day) : [...w.days, day].sort((a, b) => a - b)
    updateAt(idx, { days })
  }

  const removeAt = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx))
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography variant='subtitle2'>{t('siteRecovery.bandwidth.title')}</Typography>
        <Button
          size='small'
          startIcon={<i className='ri-add-line' />}
          onClick={() => onChange([...value, emptyWindow()])}
        >
          {t('siteRecovery.bandwidth.addWindow')}
        </Button>
      </Box>
      <Typography variant='caption' sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
        {t('siteRecovery.bandwidth.help', { rate: staticRateMbps || 0 })}
      </Typography>

      {value.length === 0 ? (
        <Box sx={{ p: 1.5, border: '1px dashed', borderColor: 'divider', borderRadius: 1, textAlign: 'center' }}>
          <Typography variant='caption' sx={{ color: 'text.secondary' }}>
            {t('siteRecovery.bandwidth.empty')}
          </Typography>
        </Box>
      ) : (
        <Stack spacing={1.25}>
          {value.map((w, idx) => (
            <Box key={idx} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.25 }}>
              {/* Days chips */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
                {DAY_KEYS.map((key, dayIdx) => {
                  const on = w.days.includes(dayIdx)
                  return (
                    <Button
                      key={key}
                      size='small'
                      variant={on ? 'contained' : 'outlined'}
                      onClick={() => toggleDay(idx, dayIdx)}
                      sx={{ minWidth: 40, px: 1, py: 0.25, fontSize: '0.7rem' }}
                    >
                      {t(`siteRecovery.schedule.days.${key}`)}
                    </Button>
                  )
                })}
                <Box sx={{ ml: 'auto' }}>
                  <Tooltip title={t('common.delete')} arrow>
                    <IconButton size='small' color='error' onClick={() => removeAt(idx)} sx={{ p: 0.5 }}>
                      <i className='ri-delete-bin-line' style={{ fontSize: 14 }} />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>

              {/* Start / End / Rate */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Box>
                  <Typography variant='caption' sx={{ color: 'text.secondary', display: 'block' }}>
                    {t('siteRecovery.bandwidth.startHour')}
                  </Typography>
                  <Select
                    value={w.start_hour}
                    size='small'
                    onChange={e => updateAt(idx, { start_hour: Number(e.target.value) })}
                    sx={{ minWidth: 80 }}
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <MenuItem key={h} value={h}>{String(h).padStart(2, '0')}:00</MenuItem>
                    ))}
                  </Select>
                </Box>
                <Box>
                  <Typography variant='caption' sx={{ color: 'text.secondary', display: 'block' }}>
                    {t('siteRecovery.bandwidth.endHour')}
                  </Typography>
                  <Select
                    value={w.end_hour}
                    size='small'
                    onChange={e => updateAt(idx, { end_hour: Number(e.target.value) })}
                    sx={{ minWidth: 80 }}
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <MenuItem key={h} value={h}>{String(h).padStart(2, '0')}:00</MenuItem>
                    ))}
                  </Select>
                </Box>
                <Box sx={{ flex: 1, minWidth: 120 }}>
                  <Typography variant='caption' sx={{ color: 'text.secondary', display: 'block' }}>
                    {t('siteRecovery.bandwidth.rate')}
                  </Typography>
                  <TextField
                    type='number'
                    size='small'
                    value={w.rate_limit_mbps}
                    onChange={e => updateAt(idx, { rate_limit_mbps: Math.max(0, Number(e.target.value) || 0) })}
                    InputProps={{ endAdornment: <Typography variant='caption' sx={{ color: 'text.secondary' }}>Mbps</Typography> }}
                    fullWidth
                  />
                </Box>
              </Box>

              {/* Preview label */}
              {w.days.length > 0 && (
                <Typography variant='caption' sx={{ color: 'primary.main', display: 'block', mt: 0.75, fontSize: '0.7rem' }}>
                  {t('siteRecovery.bandwidth.preview', {
                    days: w.days.map(d => t(`siteRecovery.schedule.days.${DAY_KEYS[d]}`)).join(', '),
                    start: String(w.start_hour).padStart(2, '0'),
                    end: String(w.end_hour).padStart(2, '0'),
                    rate: w.rate_limit_mbps === 0 ? t('siteRecovery.bandwidth.unlimited') : `${w.rate_limit_mbps} Mbps`,
                  })}
                </Typography>
              )}
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  )
}
