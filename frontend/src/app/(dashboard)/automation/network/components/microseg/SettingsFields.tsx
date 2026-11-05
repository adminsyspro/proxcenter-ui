'use client'

import { useState, type ReactNode } from 'react'
import { Box, ButtonBase, Checkbox, Collapse, Divider, FormControl, InputAdornment, MenuItem, Select, TextField, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { SMALL_SELECT_SX } from '@/components/settings/destinations/DestinationDialogParts'

import { Notice } from './PlanNotices'

import type { SelfIpsSource } from '@/lib/microseg/types'

import {
  NOTIFY_KEYS, RATE_UNITS, SETTING_NUMBER_KEYS, SETTING_UNITS, selfIpsFallback,
  type RateUnit, type SettingNumberKey, type SettingsForm, type SettingsProblems,
} from './settingsModel'
import { FLUSH_TOGGLE_SX, FormRow } from './dialogParts'

/** Width of the name column: the setting names are longer than the zone dialog ones. */
export const SETTINGS_LABEL_WIDTH = 300

/** The settings that carry an info icon, and the key of their explanation. */
const TIP_KEYS: Partial<Record<SettingNumberKey, string>> = { log_interval_sec: 'logInterval', ready_after_hours: 'readyAfter', write_cap: 'writeCap' }

/** The load settings (intervals) and the ones about enforcement, each group under its heading. */
const NUMBER_SECTIONS: Array<{ title: string; keys: SettingNumberKey[] }> = [
  { title: 'load', keys: SETTING_NUMBER_KEYS.slice(0, 4) },
  { title: 'enforcement', keys: SETTING_NUMBER_KEYS.slice(4) },
]

/** A setting on one line: its name (with its info icon) and its control, on the columns of the zone dialog. */
function FieldRow({ label, hint, tip, children }: { label: string; hint?: string; tip?: string; children: ReactNode }) {
  return (
    <FormRow label={label} tip={tip} labelWidth={SETTINGS_LABEL_WIDTH}>
      {children}
    </FormRow>
  )
}

const SECTION_TITLE_SX = { display: 'block', fontWeight: 600, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: 0.5 } as const

export function SectionTitle({ children, first = false }: { children: ReactNode; first?: boolean }) {
  return (
    <Box data-testid='settings-section' sx={{ mt: first ? 0 : 2.5, mb: 1 }}>
      {!first && <Divider data-testid='settings-section-divider' sx={{ mb: 2 }} />}
      <Typography variant='caption' color='text.primary' sx={SECTION_TITLE_SX}>
        {children}
      </Typography>
    </Box>
  )
}

/** A section heading that folds its content away, closed until it is clicked. */
function CollapsibleSection({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <Box data-testid='settings-section' sx={{ mt: 2.5 }}>
      <Divider data-testid='settings-section-divider' sx={{ mb: 2 }} />
      <ButtonBase
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1, borderRadius: 1, color: 'text.primary' }}
      >
        <Box component='i' className={open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} sx={{ fontSize: 18, lineHeight: 1 }} />
        <Typography component='span' variant='caption' sx={SECTION_TITLE_SX}>{title}</Typography>
      </ButtonBase>
      <Collapse in={open} unmountOnExit>
        {children}
      </Collapse>
    </Box>
  )
}

type TextRowProps = {
  label: string
  hint?: string
  tip?: string
  value: string
  invalid: boolean
  disabled: boolean
  unit?: string
  placeholder?: string
  /** Shown on hover of the input, for a placeholder too long for it. */
  title?: string
  numeric?: boolean
  onChange: (value: string) => void
}

function TextRow({ label, hint, tip, value, invalid, disabled, unit, placeholder, title, numeric = false, onChange }: TextRowProps) {
  return (
    <FieldRow label={label} hint={hint} tip={tip}>
      <TextField
        value={value}
        onChange={e => onChange(e.target.value)}
        error={invalid}
        disabled={disabled}
        placeholder={placeholder}
        size='small'
        autoComplete='off'
        slotProps={{
          htmlInput: { 'aria-label': label, inputMode: numeric ? 'numeric' : undefined, title },
          input: unit ? { endAdornment: <InputAdornment position='end'>{unit}</InputAdornment> } : undefined,
        }}
        fullWidth
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
  /** The addresses the preflight takes as ProxCenter's, and their source (GET /policy). */
  effectiveSelfIps?: string[]
  selfIpsSource?: SelfIpsSource
  onChange: <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) => void
}

/** The inputs of the Settings dialog, grouped under small headings, every setting on one line. */
export default function SettingsFields({ form, problems, busy, prefixWarning, effectiveSelfIps, selfIpsSource, onChange }: Props) {
  const t = useTranslations('microsegPilot.settings')
  const fallback = selfIpsFallback(effectiveSelfIps, selfIpsSource)
  const selfIpsPlaceholder = fallback
    ? `${fallback.ips} (${t(`selfIpsSource.${fallback.source}`)})`
    : t('detectedAutomatically')

  return (
    <Box>
      <SectionTitle first>{t('sections.general')}</SectionTitle>
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
              tip={TIP_KEYS[key] ? t(`tips.${TIP_KEYS[key]}`) : undefined}
              value={form[key]}
              invalid={!!problems[key]}
              disabled={busy}
              numeric
              unit={t(`unitsLong.${SETTING_UNITS[key]}`)}
              onChange={v => onChange(key, v)}
            />
          ))}
        </Box>
      ))}

      <SectionTitle>{t('sections.observation')}</SectionTitle>
      <FieldRow label={t('fields.rate')} hint={t('hints.rate')} tip={t('tips.rate')}>
        <TextField
          value={form.rate}
          onChange={e => onChange('rate', e.target.value)}
          error={!!problems.rate}
          disabled={busy}
          placeholder={t('leaveAsIs')}
          size='small'
          autoComplete='off'
          slotProps={{ htmlInput: { 'aria-label': t('fields.rate'), inputMode: 'numeric' } }}
          sx={{ flex: '1 1 0', minWidth: 0, mr: 1 }}
        />
        <FormControl size='small' sx={{ width: 130, flexShrink: 0 }}>
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

      <SectionTitle>{t('sections.notifications')}</SectionTitle>
      {NOTIFY_KEYS.map(key => (
        <FieldRow key={key} label={t(`fields.${key}`)}>
          <Checkbox
            size='small'
            sx={FLUSH_TOGGLE_SX}
            checked={form[key]}
            disabled={busy}
            onChange={e => onChange(key, e.target.checked)}
            slotProps={{ input: { 'aria-label': t(`fields.${key}`) } }}
          />
        </FieldRow>
      ))}

      <CollapsibleSection title={t('sections.advanced')}>
        <TextRow
          label={t('fields.selfIps')}
          tip={t('tips.selfIps')}
          value={form.selfIps}
          invalid={!!problems.selfIps}
          disabled={busy}
          placeholder={selfIpsPlaceholder}
          title={selfIpsPlaceholder}
          onChange={v => onChange('selfIps', v)}
        />
      </CollapsibleSection>
    </Box>
  )
}
