'use client'

import React, { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Autocomplete, Box, Checkbox, Chip, TextField, Typography } from '@mui/material'

import type { TrunkVlanChoice, TrunkVlanSource } from '@/lib/network/trunkVlanChoices'

const SOURCE_ORDER: TrunkVlanSource[] = ['sdn', 'iface', 'vdc', 'bridge']
const SEPARATOR = /[;,\s]+/

type Props = {
  /** Trunks in the Proxmox VE syntax ('225;230;605-606'). */
  value: string
  onChange: (value: string) => void
  /** VLANs known for the selected bridge (network-choices). */
  choices?: TrunkVlanChoice[]
  disabled?: boolean
  error?: boolean
  helperText?: React.ReactNode
}

/**
 * The VLAN trunks of a NIC: a dropdown of the VLANs known on the bridge (SDN
 * VLAN networks, host VLAN interfaces, vDC pools, the bridge's own VLAN ids),
 * with a checkbox per row, and free typing for any other id or range.
 */
export default function VlanTrunksPicker({ value, onChange, choices = [], disabled, error, helperText }: Props) {
  const t = useTranslations()
  const [input, setInput] = useState('')
  const tokens = useMemo(() => value.split(';').filter(Boolean), [value])

  // One row per value: the first source that names it wins, so a VLAN that is
  // both an SDN network and in a vDC pool shows once, under its name.
  const meta = useMemo(() => {
    const byValue = new Map<string, TrunkVlanChoice>()
    for (const source of SOURCE_ORDER) for (const c of choices) if (c.source === source && !byValue.has(c.value)) byValue.set(c.value, c)
    return byValue
  }, [choices])
  const options = useMemo(() => [...meta.keys()], [meta])

  const commit = (next: string[]) => {
    const flat = next.flatMap(v => v.split(SEPARATOR)).filter(Boolean)
    onChange([...new Set(flat)].join(';'))
  }

  return (
    <Autocomplete
      multiple
      freeSolo
      autoSelect
      disableCloseOnSelect
      size="small"
      limitTags={2}
      disabled={disabled}
      openOnFocus
      // At rest, one line the height of the VLAN Tag and MAC fields next to
      // it (limitTags folds the rest into "+N"); while editing, the chips wrap
      // so what is typed stays visible.
      sx={{
        '& .MuiAutocomplete-inputRoot:not(.Mui-focused)': { flexWrap: 'nowrap', overflow: 'hidden' },
        '& .MuiAutocomplete-inputRoot .MuiAutocomplete-input': { minWidth: 24 },
        '& .MuiAutocomplete-tag': { my: 0, height: 22 },
      }}
      slotProps={{ popper: { style: { minWidth: 260 }, placement: 'bottom-start' } }}
      options={options}
      value={tokens}
      inputValue={input}
      groupBy={o => meta.get(o)?.source ?? ''}
      onChange={(_e, next) => { commit(next as string[]); setInput('') }}
      onInputChange={(_e, next, reason) => {
        if (reason === 'reset') return setInput('')
        // A separator typed after an id adds it at once, like Enter.
        if (SEPARATOR.test(next.slice(-1)) && next.trim()) { commit([...tokens, next]); return setInput('') }
        setInput(next)
      }}
      renderGroup={params => (
        <li key={params.key}>
          {params.group && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, pt: 1 }}>
              {t(`hardware.nicTrunkSource.${params.group}`)}
            </Typography>
          )}
          <ul style={{ padding: 0 }}>{params.children}</ul>
        </li>
      )}
      renderOption={(props, option, { selected }) => {
        const { key, ...rest } = props as typeof props & { key: string }
        const label = meta.get(option)?.label
        return (
          <li key={key} {...rest}>
            <Checkbox size="small" checked={selected} sx={{ mr: 1, p: 0.25 }} />
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
              <Typography variant="body2">{option}</Typography>
              {label && <Typography variant="caption" color="text.secondary" noWrap title={label}>{label}</Typography>}
            </Box>
          </li>
        )
      }}
      renderValue={(tags, getItemProps) => tags.map((tag, index) => {
        const { key, ...itemProps } = getItemProps({ index })
        return <Chip key={key} size="small" label={tag} {...itemProps} />
      })}
      renderInput={params => (
        <TextField
          {...params}
          label="VLAN trunks"
          placeholder={tokens.length === 0 ? '10;20-25' : undefined}
          error={error}
          helperText={helperText}
        />
      )}
    />
  )
}
