'use client'

import { useState } from 'react'
import {
  Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, Stack, TextField, Tooltip,
} from '@mui/material'
import { useTranslations } from 'next-intl'

import type { MicrosegZone } from '@/lib/microseg/types'

import { DialogErrorLine, ONE_LINE_SX, useDialogAction } from './dialogParts'
import { validateZoneForm, ZONE_COLORS, type ZoneFormValues } from './zoneForm'

type Props = {
  /** The zone to edit, or null to create one. */
  zone: MicrosegZone | null
  /** Throws when the write fails: the dialog then keeps its input and shows the error. */
  onSave: (values: ZoneFormValues) => Promise<void>
  onClose: () => void
}

const HELPER_SX = { ...ONE_LINE_SX, mx: 0 } as const

function ColorPicker({ value, onChange, label }: { value: string; onChange: (color: string) => void; label: string }) {
  const colors: string[] = [...ZONE_COLORS]
  // A zone created elsewhere may carry a color outside the palette: keep it selectable.
  if (value && !colors.some(c => c.toLowerCase() === value.toLowerCase())) colors.push(value)
  return (
    <Box role='group' aria-label={label} sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      <Box component='span' sx={{ width: 90, flexShrink: 0, color: 'text.secondary' }}>{label}</Box>
      {colors.map(color => {
        const selected = color.toLowerCase() === value.toLowerCase()
        return (
          <Tooltip key={color} title={color}>
            <IconButton
              size='small'
              aria-label={color}
              aria-pressed={selected}
              onClick={() => onChange(color)}
              sx={{ p: 0.5, border: '2px solid', borderColor: selected ? 'text.primary' : 'transparent' }}
            >
              <Box component='span' sx={{ width: 18, height: 18, borderRadius: '50%', bgcolor: color }} />
            </IconButton>
          </Tooltip>
        )
      })}
    </Box>
  )
}

/** Create or edit a zone: name (fixed once created), label, color from a small palette, isolation. */
export default function ZoneDialog({ zone, onSave, onClose }: Props) {
  const t = useTranslations()
  const editing = zone !== null
  const [values, setValues] = useState<ZoneFormValues>({
    name: zone?.name ?? '', label: zone?.label ?? '', color: zone ? zone.color : ZONE_COLORS[0], isolate_members: zone?.isolate_members ?? false,
  })
  const [touched, setTouched] = useState(false)
  const { busy, error, run } = useDialogAction()

  const errors = validateZoneForm(values)
  const nameError = values.name !== '' || touched ? errors.name : undefined
  const set = <K extends keyof ZoneFormValues>(key: K, value: ZoneFormValues[K]) => setValues(prev => ({ ...prev, [key]: value }))

  const submit = () => {
    if (Object.keys(errors).length > 0) return
    void run(() => onSave({ ...values, label: values.label.trim() }))
  }

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth='sm' fullWidth aria-labelledby='microseg-zone-title'>
      <DialogTitle id='microseg-zone-title' sx={ONE_LINE_SX}>
        {editing ? t('microsegPilot.policy.zoneDialog.editTitle') : t('microsegPilot.policy.zoneDialog.createTitle')}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label={t('microsegPilot.policy.zoneDialog.name')}
            value={values.name}
            onChange={e => set('name', e.target.value)}
            onBlur={() => setTouched(true)}
            disabled={editing || busy}
            error={!!nameError}
            helperText={nameError ? t(nameError) : t('microsegPilot.policy.zoneDialog.nameHint')}
            slotProps={{ htmlInput: { maxLength: 14 }, formHelperText: { sx: HELPER_SX } }}
            size='small'
            fullWidth
            autoFocus={!editing}
          />
          <TextField
            label={t('microsegPilot.policy.zoneDialog.label')}
            value={values.label}
            onChange={e => set('label', e.target.value)}
            disabled={busy}
            size='small'
            fullWidth
          />
          <ColorPicker value={values.color} onChange={color => set('color', color)} label={t('microsegPilot.policy.zoneDialog.color')} />
          <FormControlLabel
            control={<Checkbox checked={values.isolate_members} onChange={e => set('isolate_members', e.target.checked)} disabled={busy} />}
            label={t('microsegPilot.policy.zoneDialog.isolate')}
            sx={{ m: 0, '& .MuiTypography-root': ONE_LINE_SX }}
          />
          {error && <DialogErrorLine message={error} />}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button onClick={submit} variant='contained' disabled={busy || Object.keys(errors).length > 0}>
          {editing ? t('microsegPilot.policy.zoneDialog.save') : t('microsegPilot.policy.zoneDialog.create')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
