'use client'

import React, { useMemo } from 'react'
import { useTranslations } from 'next-intl'

import { Autocomplete, Box, TextField, Typography, createFilterOptions, type AutocompleteRenderInputParams } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'

import { bridgeOptionSearchText, type BridgePickerOption } from './bridgeChoices'

export type BridgePickerProps = {
  options: BridgePickerOption[]
  /** Selected iface (`bridge=` value). */
  value: string
  onChange: (iface: string) => void
  label?: string
  placeholder?: string
  disabled?: boolean
  error?: boolean
  helperText?: React.ReactNode
  /** Shown in the list when nothing matches (defaults to common.noResults). */
  noOptionsText?: React.ReactNode
  /**
   * Free text mode: the input holds the iface itself and any typed name is
   * kept, the options only suggest. Without it the value must be an option.
   */
  freeSolo?: boolean
  fullWidth?: boolean
  sx?: SxProps<Theme>
}

const filterOptions = createFilterOptions<BridgePickerOption>({ stringify: bridgeOptionSearchText })

const optionText = (o: BridgePickerOption | string) => (typeof o === 'string' ? o : o.label)
const optionIface = (o: BridgePickerOption | string) => (typeof o === 'string' ? o : o.iface)

/**
 * Searchable bridge / SDN VNet picker shared by every guest NIC dialog
 * (#195): the list arrives sorted, typing filters on the label, the PVE name,
 * the hint and the caption (alias, VLAN, zone, vDC).
 */
export default function BridgePicker({
  options, value, onChange, label, placeholder, disabled, error, helperText, noOptionsText, freeSolo = false, fullWidth = true, sx,
}: BridgePickerProps) {
  const t = useTranslations()
  const selected = useMemo(() => options.find(o => o.iface === value) ?? null, [options, value])

  const renderOption = (props: React.HTMLAttributes<HTMLLIElement> & { key?: React.Key }, o: BridgePickerOption) => {
    const { key, ...rest } = props
    return (
      <li key={key ?? o.iface} {...rest}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%', minWidth: 0 }}>
          {o.icon && (
            <Box component="i" className={o.icon} sx={{ fontSize: 14, flexShrink: 0, ...(o.accentIcon ? { color: 'primary.main' } : { opacity: 0.6 }) }} />
          )}
          <Typography variant="body2" noWrap>{o.label}</Typography>
          {o.hint && <Typography variant="caption" noWrap sx={{ opacity: 0.45 }}>{o.hint}</Typography>}
          {o.detail && <Typography variant="caption" noWrap sx={{ ml: 'auto', pl: 1, opacity: 0.6 }}>{o.detail}</Typography>}
        </Box>
      </li>
    )
  }

  const renderInput = (params: AutocompleteRenderInputParams) => (
    <TextField {...params} label={label} placeholder={placeholder} error={error} helperText={helperText} />
  )

  const common = {
    options,
    size: 'small' as const,
    fullWidth,
    disabled,
    sx,
    filterOptions,
    noOptionsText: noOptionsText ?? t('common.noResults'),
    renderOption,
    renderInput,
  }

  if (freeSolo) {
    // The input text is the iface: picking an option writes its iface, typing
    // keeps whatever name the user enters.
    return (
      <Autocomplete<BridgePickerOption, false, true, true>
        {...common}
        freeSolo
        disableClearable
        value={selected ?? value}
        inputValue={value}
        getOptionLabel={optionIface}
        isOptionEqualToValue={(o, v) => o.iface === optionIface(v)}
        onInputChange={(_, next) => onChange(next)}
        onChange={(_, next) => { if (next != null) onChange(optionIface(next)) }}
      />
    )
  }

  return (
    <Autocomplete<BridgePickerOption, false, true, false>
      {...common}
      disableClearable
      value={selected as BridgePickerOption}
      getOptionLabel={optionText}
      isOptionEqualToValue={(o, v) => o.iface === v.iface}
      onChange={(_, next) => onChange(next.iface)}
    />
  )
}
