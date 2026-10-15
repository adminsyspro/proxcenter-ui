'use client'

// "Restore tags" switch shared by the three restore dialogs (#965): the
// single-guest dialog, the PBS storage browser and the bulk restore wizard.

import { useTranslations } from 'next-intl'
import { Box, Checkbox, FormControlLabel, Switch, Typography } from '@mui/material'

interface Props {
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
  /** The PBS storage browser lays its restore flags out as checkboxes. */
  control?: 'switch' | 'checkbox'
}

export default function RestoreTagsSwitch({ checked, onChange, disabled, control = 'switch' }: Readonly<Props>) {
  const t = useTranslations()
  const inputProps = { 'aria-label': t('inventory.pbsRestoreTags'), 'data-testid': 'restore-tags-switch' } as const

  return (
    <Box>
      <FormControlLabel
        control={
          control === 'checkbox'
            ? <Checkbox size='small' checked={checked} onChange={(_, v) => onChange(v)} disabled={disabled} inputProps={inputProps} />
            : <Switch checked={checked} onChange={(_, v) => onChange(v)} disabled={disabled} inputProps={inputProps} />
        }
        label={control === 'checkbox' ? <Typography variant='body2'>{t('inventory.pbsRestoreTags')}</Typography> : t('inventory.pbsRestoreTags')}
      />
      <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mt: -0.5 }}>
        {checked ? t('inventory.pbsRestoreTagsKeepHelp') : t('inventory.pbsRestoreTagsOmitHelp')}
      </Typography>
    </Box>
  )
}
