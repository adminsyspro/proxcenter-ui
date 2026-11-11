'use client'

// Audience and publication of a custom role (ui#1336), shown in the role
// dialog of the provider view. One line per setting: the audience select with
// its meaning, then, for a published audience, the "all tenants" switch and
// the tenant boxes.

import Box from '@mui/material/Box'
import FormControlLabel from '@mui/material/FormControlLabel'
import MenuItem from '@mui/material/MenuItem'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'

import { PUBLISHED_AUDIENCES, ROLE_AUDIENCES, type RoleAudience } from '@/lib/rbac/rolePublication'

import { AUDIENCE_DESC_KEYS, AUDIENCE_ICONS, AUDIENCE_LABEL_KEYS, type TenantOption } from './catalogueClient'
import TenantCheckboxGrid from './TenantCheckboxGrid'

/** Select value of a legacy role (no audience yet). */
export const LEGACY_AUDIENCE = 'legacy'

type Props = {
  audience: RoleAudience | null
  onAudienceChange: (next: RoleAudience) => void
  publishAll: boolean
  onPublishAllChange: (next: boolean) => void
  tenantIds: string[]
  onTenantIdsChange: (next: string[]) => void
  tenants: TenantOption[]
  /** The role has no audience yet (created before the catalogue): offer to keep it as is. */
  legacy?: boolean
  disabled?: boolean
  t: (key: string, values?: Record<string, unknown>) => string
}

const LABEL_SX = { width: 120, flexShrink: 0, fontWeight: 600 } as const

export default function RolePublicationEditor({
  audience,
  onAudienceChange,
  publishAll,
  onPublishAllChange,
  tenantIds,
  onTenantIdsChange,
  tenants,
  legacy = false,
  disabled = false,
  t,
}: Readonly<Props>) {
  const published = audience !== null && PUBLISHED_AUDIENCES.includes(audience)
  const customers = tenants.filter(tn => tn.id !== 'default')
  const descKey = audience ? AUDIENCE_DESC_KEYS[audience] : 'rbacPage.catalogue.audienceLegacyDesc'

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
        <Typography variant='body2' sx={LABEL_SX}>{t('rbacPage.catalogue.audience')}</Typography>
        <TextField
          select
          size='small'
          value={audience ?? LEGACY_AUDIENCE}
          onChange={e => {
            if (e.target.value !== LEGACY_AUDIENCE) onAudienceChange(e.target.value as RoleAudience)
          }}
          disabled={disabled}
          sx={{ width: 240, flexShrink: 0 }}
          slotProps={{ htmlInput: { 'aria-label': t('rbacPage.catalogue.audience') } }}
        >
          {legacy && (
            <MenuItem value={LEGACY_AUDIENCE}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className='ri-history-line' style={{ fontSize: 16 }} />
                {t('rbacPage.catalogue.audienceLegacy')}
              </Box>
            </MenuItem>
          )}
          {ROLE_AUDIENCES.map(a => (
            <MenuItem key={a} value={a}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className={AUDIENCE_ICONS[a]} style={{ fontSize: 16 }} />
                {t(AUDIENCE_LABEL_KEYS[a])}
              </Box>
            </MenuItem>
          ))}
        </TextField>
        <Typography variant='caption' noWrap title={t(descKey)} sx={{ opacity: 0.7, minWidth: 0 }}>
          {t(descKey)}
        </Typography>
      </Box>

      {published && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
          <Typography variant='body2' sx={LABEL_SX}>{t('rbacPage.catalogue.publication')}</Typography>
          <FormControlLabel
            disabled={disabled}
            sx={{ m: 0, minWidth: 0 }}
            control={<Switch size='small' checked={publishAll} onChange={e => onPublishAllChange(e.target.checked)} />}
            label={<Typography variant='body2' noWrap>{t('rbacPage.catalogue.publishAll')}</Typography>}
          />
        </Box>
      )}

      {published && !publishAll && (
        <Box sx={{ pl: '136px' }}>
          <TenantCheckboxGrid tenants={customers} value={tenantIds} onChange={onTenantIdsChange} disabled={disabled} t={t} />
        </Box>
      )}
    </Box>
  )
}
