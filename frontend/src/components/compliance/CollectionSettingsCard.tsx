'use client'

import { useTranslations } from 'next-intl'
import { Box, Card, CardContent, Divider, MenuItem, TextField, Typography } from '@mui/material'

import NumericTextField from '@/components/ui/NumericTextField'
import {
  COLLECTION_CACHE_MINUTES_CHOICES,
  DEFAULT_COLLECTION_CACHE_MINUTES,
  DEFAULT_GUEST_CONCURRENCY,
  MAX_GUEST_CONCURRENCY,
  MIN_GUEST_CONCURRENCY,
} from '@/lib/compliance/collectionSettings'

// A small select is 2 px taller than a small text field: aligned on it here,
// since both sit on the same line.
const SMALL_SELECT_SX = { '& .MuiInputBase-input.MuiSelect-select': { minHeight: '1.4375em', lineHeight: '1.4375em' } }

interface CollectionSettingsCardProps {
  cacheMinutes: number | undefined
  guestConcurrency: number | undefined
  onChange: (field: 'compliance_cache_minutes' | 'compliance_guest_concurrency', value: number) => void
}

/**
 * How the compliance screens read Proxmox VE: how long one collection is
 * reused, and how many guests are read at the same time. Part of the Policies
 * form, saved with it.
 */
export default function CollectionSettingsCard({ cacheMinutes, guestConcurrency, onChange }: CollectionSettingsCardProps) {
  const t = useTranslations('compliance.collection')

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <i className="ri-radar-line" style={{ fontSize: 20 }} />
          <Typography variant="h6">{t('title')}</Typography>
        </Box>
        <Divider sx={{ mb: 2 }} />
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
          <TextField
            select
            size="small"
            label={t('cacheMinutes')}
            value={cacheMinutes ?? DEFAULT_COLLECTION_CACHE_MINUTES}
            onChange={(e) => onChange('compliance_cache_minutes', Number(e.target.value))}
            helperText={t('cacheMinutesHelper')}
            sx={{ flex: 1, ...SMALL_SELECT_SX }}
          >
            {COLLECTION_CACHE_MINUTES_CHOICES.map(m => (
              <MenuItem key={m} value={m}>
                {m === 0 ? t('cacheNever') : t('cacheMinutesValue', { minutes: m })}
              </MenuItem>
            ))}
          </TextField>
          <NumericTextField
            type="number"
            label={t('guestConcurrency')}
            value={guestConcurrency ?? DEFAULT_GUEST_CONCURRENCY}
            onChange={(v) => onChange('compliance_guest_concurrency', v)}
            fallback={DEFAULT_GUEST_CONCURRENCY}
            min={MIN_GUEST_CONCURRENCY}
            max={MAX_GUEST_CONCURRENCY}
            size="small"
            helperText={t('guestConcurrencyHelper', { requests: 3 * (guestConcurrency ?? DEFAULT_GUEST_CONCURRENCY) })}
            slotProps={{ htmlInput: { min: MIN_GUEST_CONCURRENCY, max: MAX_GUEST_CONCURRENCY } }}
            sx={{ flex: 1 }}
          />
        </Box>
      </CardContent>
    </Card>
  )
}
