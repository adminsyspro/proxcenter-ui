'use client'

// A fixed list of tenants as visible check boxes, with a three-state "All"
// master box (convention of the configuration dialogs, ui#1105).

import Box from '@mui/material/Box'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import Typography from '@mui/material/Typography'

import type { TenantOption } from './catalogueClient'

type Props = {
  tenants: TenantOption[]
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  t: (key: string, values?: Record<string, unknown>) => string
}

export default function TenantCheckboxGrid({ tenants, value, onChange, disabled = false, t }: Readonly<Props>) {
  const selected = new Set(value)
  const count = tenants.filter(tn => selected.has(tn.id)).length
  const all = tenants.length > 0 && count === tenants.length

  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(tenants.filter(tn => next.has(tn.id)).map(tn => tn.id))
  }

  if (tenants.length === 0) {
    return (
      <Typography variant='body2' sx={{ opacity: 0.6 }}>
        {t('rbacPage.catalogue.noTenants')}
      </Typography>
    )
  }

  return (
    <Box component='fieldset' sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, px: 1.5, py: 0.5, m: 0 }}>
      <FormControlLabel
        disabled={disabled}
        control={
          <Checkbox
            size='small'
            checked={all}
            indeterminate={count > 0 && !all}
            onChange={() => onChange(all ? [] : tenants.map(tn => tn.id))}
          />
        }
        label={<Typography variant='body2' sx={{ fontWeight: 600 }}>{t('rbacPage.catalogue.allTenantsBox')}</Typography>}
      />
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))' }, columnGap: 1 }}>
        {tenants.map(tn => (
          <FormControlLabel
            key={tn.id}
            disabled={disabled}
            sx={{ minWidth: 0, mr: 0 }}
            control={<Checkbox size='small' checked={selected.has(tn.id)} onChange={() => toggle(tn.id)} />}
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                <i className='ri-building-line' style={{ fontSize: 15, opacity: 0.7, flexShrink: 0 }} />
                <Typography variant='body2' noWrap title={tn.name}>{tn.name}</Typography>
              </Box>
            }
          />
        ))}
      </Box>
    </Box>
  )
}
