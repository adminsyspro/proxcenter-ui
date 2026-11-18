'use client'

import { useState } from 'react'

import { useTranslations } from 'next-intl'

import { Box, Button, IconButton, TextField, Tooltip } from '@mui/material'

import { MAX_NAMED_NETWORKS, MAX_NETWORK_NAME, parseNetwork, type NamedNetwork } from '@/lib/microseg/namedNetworks'

import { OneLine } from './dialogParts'

type Props = {
  networks: NamedNetwork[]
  disabled?: boolean
  onChange: (next: NamedNetwork[]) => void
}

/**
 * The networks the admin names, one per line: its name, its CIDR, and a button to take it out; "Add a network" under
 * the last one. A name or a CIDR that cannot be saved is marked as it is typed; the dialog says the first problem.
 */
export default function NamedNetworksField({ networks, disabled = false, onChange }: Props) {
  const t = useTranslations('microsegPilot.settings.networks')
  const set = (index: number, patch: Partial<NamedNetwork>) => onChange(networks.map((n, i) => (i === index ? { ...n, ...patch } : n)))
  // The rows have no identity of their own: each gets a local key, kept when another row is added or taken out, so the
  // focus and the marks stay on the row they belong to. A list of another length from outside starts new keys.
  const [rows, setRows] = useState(() => ({ keys: networks.map((_n, i) => i), next: networks.length }))
  let keys = rows.keys
  if (keys.length !== networks.length) {
    keys = networks.map((_n, i) => rows.next + i)
    setRows({ keys, next: rows.next + networks.length })
  }
  const add = () => {
    setRows({ keys: [...keys, rows.next], next: rows.next + 1 })
    onChange([...networks, { name: '', cidr: '' }])
  }
  const remove = (index: number) => {
    setRows({ keys: keys.filter((_k, i) => i !== index), next: rows.next })
    onChange(networks.filter((_n, i) => i !== index))
  }

  return (
    <Box data-testid='named-networks'>
      {networks.length === 0 && <OneLine text={t('empty')} />}
      {networks.map((network, index) => {
        const name = network.name.trim()
        const badName = name === '' || [...name].length > MAX_NETWORK_NAME
        const badCidr = !parseNetwork(network.cidr)
        return (
          <Box key={keys[index]} role='group' aria-label={name || t('unnamed', { index: index + 1 })} sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, mb: 1 }}>
            <TextField
              size='small'
              value={network.name}
              disabled={disabled}
              error={badName}
              placeholder={t('name')}
              onChange={e => set(index, { name: e.target.value })}
              slotProps={{ htmlInput: { 'aria-label': t('name'), maxLength: MAX_NETWORK_NAME } }}
              sx={{ flex: '1 1 0', minWidth: 0 }}
            />
            <TextField
              size='small'
              value={network.cidr}
              disabled={disabled}
              error={badCidr}
              placeholder='192.168.72.0/24'
              onChange={e => set(index, { cidr: e.target.value })}
              slotProps={{ htmlInput: { 'aria-label': t('cidr') } }}
              sx={{ flex: '1 1 0', minWidth: 0 }}
            />
            <Tooltip title={t('remove')}>
              <span>
                <IconButton size='small' aria-label={t('remove')} disabled={disabled} onClick={() => remove(index)} sx={{ flexShrink: 0 }}>
                  <i className='ri-delete-bin-line' aria-hidden style={{ fontSize: 18 }} />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        )
      })}
      <Button
        size='small'
        startIcon={<i className='ri-add-line' aria-hidden />}
        disabled={disabled || networks.length >= MAX_NAMED_NETWORKS}
        onClick={add}
        sx={{ textTransform: 'none' }}
      >
        {t('add')}
      </Button>
    </Box>
  )
}
