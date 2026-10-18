'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Autocomplete, Box, Chip, FormControl, InputLabel, MenuItem, Select, Stack, TextField, Typography } from '@mui/material'

export interface CatalogVisibility {
  /** The "everyone" shortcut carried by the entry itself. */
  isShared: boolean
  /** Tenants the entry is granted to when it is not shared with everyone. */
  grantTenantIds: string[]
}

export type CatalogVisibilityMode = 'private' | 'everyone' | 'tenants'

/** What a visibility record means, for the selector and for the list badges. */
export function visibilityMode(v: { isShared?: boolean | null; grantTenantIds?: string[] | null }): CatalogVisibilityMode {
  if (v.isShared) return 'everyone'
  if (v.grantTenantIds && v.grantTenantIds.length > 0) return 'tenants'
  return 'private'
}

interface TenantOption { id: string; name: string; slug: string }

interface Props {
  value: CatalogVisibility
  onChange: (next: CatalogVisibility) => void
  /** Per-vDC grants of the entry, managed on the vDC itself; shown for information. */
  vdcGrantCount?: number
}

/**
 * Provider-only visibility of a catalogue entry (#903): private, every
 * tenant (`isShared`), or a list of tenants (per-tenant grants). Per-vDC
 * grants are not edited here: they belong to the vDC, next to its ISO
 * library grant, so the field only reports how many there are.
 */
export default function CatalogVisibilityField({ value, onChange, vdcGrantCount = 0 }: Props) {
  const t = useTranslations()
  const [tenants, setTenants] = useState<TenantOption[]>([])
  // "Selected tenants" with nothing ticked yet is the same record as
  // "private"; the picker must still show while the list is being built.
  const [pickingTenants, setPickingTenants] = useState(false)
  const recordMode = visibilityMode(value)
  const mode: CatalogVisibilityMode = recordMode === 'private' && pickingTenants ? 'tenants' : recordMode

  useEffect(() => {
    let cancelled = false
    fetch('/api/v1/tenants')
      .then(r => (r.ok ? r.json() : { data: [] }))
      .then(res => {
        if (cancelled) return
        const rows: TenantOption[] = (res?.data || [])
          .filter((tn: any) => tn?.id && tn.id !== 'default')
          .map((tn: any) => ({ id: String(tn.id), name: String(tn.name ?? tn.slug ?? tn.id), slug: String(tn.slug ?? '') }))
        setTenants(rows)
      })
      .catch(() => { if (!cancelled) setTenants([]) })
    return () => { cancelled = true }
  }, [])

  const setMode = (next: CatalogVisibilityMode) => {
    setPickingTenants(next === 'tenants')
    if (next === 'everyone') onChange({ isShared: true, grantTenantIds: value.grantTenantIds })
    else if (next === 'private') onChange({ isShared: false, grantTenantIds: [] })
    else onChange({ isShared: false, grantTenantIds: value.grantTenantIds })
  }

  const selected = value.grantTenantIds
    .map(id => tenants.find(tn => tn.id === id) ?? { id, name: id, slug: '' })

  return (
    <Stack spacing={1.5} data-testid="catalog-visibility">
      <FormControl size="small" fullWidth>
        <InputLabel id="catalog-visibility-label">{t('templates.catalog.visibilityLabel')}</InputLabel>
        <Select
          labelId="catalog-visibility-label"
          label={t('templates.catalog.visibilityLabel')}
          value={mode}
          onChange={e => setMode(e.target.value as CatalogVisibilityMode)}
          inputProps={{ 'aria-label': t('templates.catalog.visibilityLabel') }}
        >
          <MenuItem value="private">{t('templates.catalog.visibilityPrivate')}</MenuItem>
          <MenuItem value="everyone">{t('templates.catalog.visibilityEveryone')}</MenuItem>
          <MenuItem value="tenants">{t('templates.catalog.visibilityTenants')}</MenuItem>
        </Select>
      </FormControl>
      {mode === 'tenants' && (
        <Autocomplete
          multiple
          size="small"
          options={tenants}
          value={selected}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          getOptionLabel={o => o.name}
          onChange={(_, next) => onChange({ isShared: false, grantTenantIds: next.map(o => o.id) })}
          renderTags={(tagValue, getTagProps) => tagValue.map((option, index) => {
            const { key, ...tagProps } = getTagProps({ index })
            return <Chip key={key} size="small" label={option.name} {...tagProps} />
          })}
          renderInput={params => (
            <TextField
              {...params}
              label={t('templates.catalog.visibilityTenantsPick')}
              helperText={t('templates.catalog.visibilityTenantsHelp')}
            />
          )}
        />
      )}
      {mode !== 'tenants' && (
        <Typography variant="caption" sx={{ opacity: 0.65 }}>
          {mode === 'everyone' ? t('templates.catalog.shareWithTenantsHelp') : t('templates.catalog.visibilityPrivateHelp')}
        </Typography>
      )}
      {vdcGrantCount > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <i className="ri-building-2-line" style={{ fontSize: 14, opacity: 0.7 }} />
          <Typography variant="caption" sx={{ opacity: 0.8 }}>
            {t('templates.catalog.visibilityVdcGrants', { count: vdcGrantCount })}
          </Typography>
        </Box>
      )}
    </Stack>
  )
}

/**
 * Short badge text for a list: "All tenants", "Private", or the counts of
 * tenants and vDCs the entry is granted to.
 */
export function visibilityBadge(
  t: (key: string, values?: Record<string, number>) => string,
  entry: { isShared?: boolean | null; grants?: { tenantIds?: string[]; vdcIds?: string[] } | null },
): { label: string; color: 'default' | 'success' | 'info' } {
  if (entry.isShared) return { label: t('templates.catalog.visibilityChipEveryone'), color: 'success' }
  const tenants = entry.grants?.tenantIds?.length ?? 0
  const vdcs = entry.grants?.vdcIds?.length ?? 0
  if (tenants + vdcs === 0) return { label: t('templates.catalog.visibilityChipPrivate'), color: 'default' }
  const parts: string[] = []
  if (tenants > 0) parts.push(t('templates.catalog.visibilityTenantsCount', { count: tenants }))
  if (vdcs > 0) parts.push(t('templates.catalog.visibilityVdcsCount', { count: vdcs }))
  return { label: parts.join(', '), color: 'info' }
}
