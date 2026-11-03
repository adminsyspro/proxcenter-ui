'use client'

import { createContext, useContext, useMemo, useState, type HTMLAttributes, type Key } from 'react'
import { Autocomplete, Box, Chip, Paper, TextField, Tooltip, Typography, type PaperProps } from '@mui/material'
import { useTranslations } from 'next-intl'

import { StatusIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'
import type { MicrosegZone } from '@/lib/microseg/types'

import { MAX_OPTIONS, filterTargets, matchesTarget, type TargetGuest } from './targetModel'

type Props = {
  candidates: TargetGuest[]
  zonesById: Map<string, MicrosegZone>
  target: TargetGuest | null
  onTarget: (next: TargetGuest | null) => void
  /** The "Targeting" chip was clicked: show the panel of the guest again. */
  onShowPanel: () => void
}

const optionLabel = (o: TargetGuest) => o.name
const sameGuest = (a: TargetGuest, b: TargetGuest) => a.key === b.key

/** The note under the options when the search matches more guests than the list shows (null: none). */
const HintContext = createContext<string | null>(null)

/** The paper of the list, with the "type to narrow" note under the options when there is one. */
function HintPaper({ children, ...props }: PaperProps) {
  const hint = useContext(HintContext)
  return (
    <Paper {...props}>
      {children}
      {hint && (
        <Typography noWrap variant='caption' color='text.secondary' role='note' sx={{ display: 'block', px: 2, py: 1, borderTop: 1, borderColor: 'divider' }}>
          {hint}
        </Typography>
      )}
    </Paper>
  )
}

/** The zone of an option: its dot and name, or "no zone". */
function ZoneOf({ zone, none }: { zone: MicrosegZone | undefined; none: string }) {
  return (
    <Box component='span' sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, minWidth: 0, flex: '0 1 auto' }}>
      <Box component='span' aria-hidden sx={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, bgcolor: zone ? zone.color || 'text.disabled' : 'transparent', border: zone ? 0 : '1px dashed', borderColor: 'text.disabled' }} />
      <Typography component='span' noWrap variant='caption' color='text.secondary'>{zone?.name ?? none}</Typography>
    </Box>
  )
}

/**
 * "Target a VM": a search over the running guests of the connection (name, VMID, address), each option on one line
 * (glyph, name, VMID, zone). The pick focuses the map on that guest until it is cleared; the "Targeting" chip
 * beside it reminds the lock, shows the guest panel again on a click, and clears the target with its cross.
 */
export default function TargetPicker({ candidates, zonesById, target, onTarget, onShowPanel }: Props) {
  const t = useTranslations('microsegPilot.overview.target')
  const zoneName = (c: TargetGuest) => (c.zoneId ? zonesById.get(c.zoneId)?.name : undefined) ?? t('noZone')
  // The search filters from the first key typed; the name of the guest picked (shown in the field) filters nothing.
  const [query, setQuery] = useState('')
  const filter = query === target?.name ? '' : query
  const matching = useMemo(() => candidates.filter(c => matchesTarget(c, filter)).length, [candidates, filter])
  const hint = matching > MAX_OPTIONS ? t('more', { shown: MAX_OPTIONS, count: matching }) : null
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      <HintContext.Provider value={hint}>
        <Autocomplete
          size='small'
          sx={{ width: 260, flexShrink: 0 }}
          options={candidates}
          value={target}
          onChange={(_e, next) => onTarget(next)}
          inputValue={query}
          onInputChange={(_e, next) => setQuery(next)}
          filterOptions={options => filterTargets(options, filter)}
          getOptionLabel={optionLabel}
          isOptionEqualToValue={sameGuest}
          slots={{ paper: HintPaper }}
          noOptionsText={t('noOptions')}
          clearText={t('clear')}
          openText={t('openList')}
          closeText={t('closeList')}
          renderOption={(props, o) => {
            const { key, ...rest } = props as HTMLAttributes<HTMLLIElement> & { key: Key }
            return (
              <Box
                component='li'
                key={key}
                {...rest}
                aria-label={t('option', { name: o.name, vmid: o.vmid, zone: zoneName(o) })}
                sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, whiteSpace: 'nowrap' }}
              >
                <StatusIcon type='vm' vmType={o.type} status={o.status} />
                <Typography noWrap sx={{ flex: '0 1 auto', minWidth: 0 }}>{o.name}</Typography>
                <Typography noWrap variant='caption' color='text.secondary' sx={{ flexShrink: 0 }}>{o.vmid}</Typography>
                <Box sx={{ flex: 1 }} />
                <ZoneOf zone={o.zoneId ? zonesById.get(o.zoneId) : undefined} none={t('noZone')} />
              </Box>
            )
          }}
          renderInput={params => (
            <TextField
              {...params}
              placeholder={t('placeholder')}
              slotProps={{ htmlInput: { ...params.inputProps, 'aria-label': t('label') } }}
            />
          )}
        />
      </HintContext.Provider>
      {target && (
        <Tooltip title={t('chipHint', { name: target.name })}>
          <Chip
            size='small'
            color='primary'
            variant='outlined'
            icon={<i className='ri-focus-3-line' />}
            label={t('chip', { name: target.name })}
            onClick={onShowPanel}
            onDelete={() => onTarget(null)}
            sx={{ minWidth: 0, maxWidth: 220 }}
          />
        </Tooltip>
      )}
    </Box>
  )
}
