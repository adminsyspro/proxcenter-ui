'use client'

import type { ReactNode } from 'react'
import { Box, Checkbox, FormControl, InputAdornment, MenuItem, Select, TextField, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { SMALL_SELECT_SX } from '@/components/settings/destinations/DestinationDialogParts'

import { Notice } from './PlanNotices'

import {
  NOTIFY_KEYS, RATE_UNITS, SETTING_NUMBER_KEYS, SETTING_UNITS, type RateUnit, type SettingNumberKey, type SettingsForm, type SettingsProblems,
} from './settingsModel'

const FIELD_WIDTH = 190

/** The load settings (intervals) and the ones about enforcement, each group under its heading. */
const NUMBER_SECTIONS: Array<{ title: string; keys: SettingNumberKey[] }> = [
  { title: 'load', keys: SETTING_NUMBER_KEYS.slice(0, 4) },
  { title: 'enforcement', keys: SETTING_NUMBER_KEYS.slice(4) },
]

/** A setting on one line: its name (the hint as a tooltip) and its control. */
function FieldRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minHeight: 44, minWidth: 0 }}>
      <Tooltip title={hint ?? label}>
        <Typography noWrap sx={{ flex: '1 1 0', minWidth: 0 }}>{label}</Typography>
      </Tooltip>
      {children}
    </Box>
  )
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mt: 1.5, textTransform: 'uppercase', letterSpacing: 0.5 }}>
      {children}
    </Typography>
  )
}

type TextRowProps = {
  label: string
  hint?: string
  value: string
  invalid: boolean
  disabled: boolean
  unit?: string
  placeholder?: string
  width?: number
  numeric?: boolean
  onChange: (value: string) => void
}

function TextRow({ label, hint, value, invalid, disabled, unit, placeholder, width = FIELD_WIDTH, numeric = false, onChange }: TextRowProps) {
  return (
    <FieldRow label={label} hint={hint}>
      <TextField
        value={value}
        onChange={e => onChange(e.target.value)}
        error={invalid}
        disabled={disabled}
        placeholder={placeholder}
        size='small'
        autoComplete='off'
        slotProps={{
          htmlInput: { 'aria-label': label, inputMode: numeric ? 'numeric' : undefined },
          input: unit ? { endAdornment: <InputAdornment position='end'>{unit}</InputAdornment> } : undefined,
        }}
        sx={{ width, flexShrink: 0 }}
      />
    </FieldRow>
  )
}

type Props = {
  form: SettingsForm
  problems: SettingsProblems
  busy: boolean
  /** The tag prefix was changed on a policy that has zones: say what that does. */
  prefixWarning: boolean
  onChange: <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) => void
}

/** The inputs of the Settings dialog, grouped under small headings, every setting on one line. */
export default function SettingsFields({ form, problems, busy, prefixWarning, onChange }: Props) {
  const t = useTranslations('microsegPilot.settings')

  return (
    <Box>
      <SectionTitle>{t('sections.general')}</SectionTitle>
      <TextRow
        label={t('fields.tagPrefix')}
        hint={t('hints.tagPrefix')}
        value={form.tagPrefix}
        invalid={!!problems.tagPrefix}
        disabled={busy}
        onChange={v => onChange('tagPrefix', v)}
      />
      {prefixWarning && <Notice severity='warning' text={t('prefixChange.warning')} />}

      {NUMBER_SECTIONS.map(section => (
        <Box key={section.title}>
          <SectionTitle>{t(`sections.${section.title}`)}</SectionTitle>
          {section.keys.map(key => (
            <TextRow
              key={key}
              label={t(`fields.${key}`)}
              hint={key === 'write_cap' ? t('hints.write_cap') : undefined}
              value={form[key]}
              invalid={!!problems[key]}
              disabled={busy}
              numeric
              unit={SETTING_UNITS[key] === 'writes' ? undefined : t(`unitsLong.${SETTING_UNITS[key]}`)}
              onChange={v => onChange(key, v)}
            />
          ))}
        </Box>
      ))}

      <SectionTitle>{t('sections.observation')}</SectionTitle>
      <FieldRow label={t('fields.rate')} hint={t('hints.rate')}>
        <TextField
          value={form.rate}
          onChange={e => onChange('rate', e.target.value)}
          error={!!problems.rate}
          disabled={busy}
          placeholder={t('leaveAsIs')}
          size='small'
          autoComplete='off'
          slotProps={{ htmlInput: { 'aria-label': t('fields.rate'), inputMode: 'numeric' } }}
          sx={{ width: 100, flexShrink: 0 }}
        />
        <FormControl size='small' sx={{ width: 120, flexShrink: 0 }}>
          <Select
            value={form.rateUnit}
            disabled={busy}
            onChange={e => onChange('rateUnit', e.target.value as RateUnit)}
            inputProps={{ 'aria-label': t('fields.rateUnit') }}
            sx={SMALL_SELECT_SX}
          >
            {RATE_UNITS.map(unit => <MenuItem key={unit} value={unit}>{t(`rateUnit.${unit}`)}</MenuItem>)}
          </Select>
        </FormControl>
      </FieldRow>
      <TextRow
        label={t('fields.burst')}
        hint={t('hints.rate')}
        value={form.burst}
        invalid={!!problems.burst}
        disabled={busy}
        numeric
        placeholder={t('leaveAsIs')}
        onChange={v => onChange('burst', v)}
      />

      <SectionTitle>{t('sections.address')}</SectionTitle>
      <TextRow
        label={t('fields.selfIps')}
        hint={t('hints.selfIps')}
        value={form.selfIps}
        invalid={!!problems.selfIps}
        disabled={busy}
        placeholder={t('detectedAutomatically')}
        width={260}
        onChange={v => onChange('selfIps', v)}
      />

      <SectionTitle>{t('sections.notifications')}</SectionTitle>
      {NOTIFY_KEYS.map(key => (
        <FieldRow key={key} label={t(`fields.${key}`)}>
          <Checkbox
            size='small'
            checked={form[key]}
            disabled={busy}
            onChange={e => onChange(key, e.target.checked)}
            slotProps={{ input: { 'aria-label': t(`fields.${key}`) } }}
          />
        </FieldRow>
      ))}
    </Box>
  )
}
