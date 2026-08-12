'use client'

import { useMemo } from 'react'

import { Autocomplete, Box, TextField } from '@mui/material'
import type { SxProps, Theme } from '@mui/material'

import * as firewallAPI from '@/lib/api/firewall'

export interface AliasIpsetOption {
  label: string
  /** CIDR of an alias, or the IPSet's comment / entry count. */
  secondary?: string
}

/**
 * The suggestion list every rule dialog offers for source and destination:
 * the firewall aliases first, then the IPSets, whose PVE reference form is
 * `+name`. Memoised so the two fields of a dialog share one array, exactly
 * as the panels did when they each carried this `useMemo`.
 */
export function useAliasIpsetOptions(aliases: firewallAPI.Alias[], ipsets: firewallAPI.IPSet[]): AliasIpsetOption[] {
  return useMemo(() => {
    const opts: AliasIpsetOption[] = []

    for (const a of aliases) opts.push({ label: a.name, secondary: a.cidr })
    for (const s of ipsets) opts.push({ label: `+${s.name}`, secondary: s.comment || `${s.members?.length || 0} entries` })

    return opts
  }, [aliases, ipsets])
}

interface AliasIpsetAutocompleteProps {
  options: AliasIpsetOption[]
  /** Raw PVE value: an IP, a CIDR, an alias or `+ipset`. */
  value: string
  onChange: (value: string) => void
  label: string
  placeholder: string
  /**
   * The VM/CT rule dialog compacts every field to 13px; the cluster, host and
   * security group dialogs keep the MUI default, so the override is opt-in.
   */
  inputSx?: SxProps<Theme>
}

/**
 * Source / destination field of a firewall rule dialog: free text (PVE takes
 * an IP or a CIDR) with the aliases and IPSets of the connection as
 * suggestions, each showing its CIDR or entry count on the right.
 */
export default function AliasIpsetAutocomplete({ options, value, onChange, label, placeholder, inputSx }: AliasIpsetAutocompleteProps) {
  return (
    <Autocomplete
      freeSolo
      options={options}
      getOptionLabel={(opt) => typeof opt === 'string' ? opt : opt.label}
      inputValue={value}
      onInputChange={(_, v) => onChange(v)}
      renderOption={(props, opt) => (
        <li {...props} key={typeof opt === 'string' ? opt : opt.label}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
            <span style={{ fontSize: 12 }}>{typeof opt === 'string' ? opt : opt.label}</span>
            {typeof opt !== 'string' && opt.secondary && (
              <span style={{ fontSize: 11, opacity: 0.6, marginLeft: 8 }}>{opt.secondary}</span>
            )}
          </Box>
        </li>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          fullWidth
          size="small"
          label={label}
          placeholder={placeholder}
          InputProps={inputSx ? { ...params.InputProps, sx: inputSx } : params.InputProps}
        />
      )}
    />
  )
}
