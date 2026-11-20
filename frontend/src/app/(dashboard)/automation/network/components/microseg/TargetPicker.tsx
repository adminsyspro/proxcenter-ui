'use client'

import { createContext, useContext, useMemo, useState, type HTMLAttributes, type Key, type ReactNode } from 'react'
import { Autocomplete, Box, Checkbox, Chip, FormControlLabel, Paper, TextField, Tooltip, Typography, useTheme, type PaperProps } from '@mui/material'
import { useTranslations } from 'next-intl'

import { StatusIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'
import { NodeGlyph } from '@/components/ui/glyphs'
import type { MicrosegZone } from '@/lib/microseg/types'

import ClusterChip from './ClusterChip'
import ConnectionGlyph, { useConnectionKind } from './ConnectionGlyph'
import { itemName, matchesItem, searchItems, type FilterItem } from './mapFilterModel'
import { MAX_OPTIONS, type TargetGuest } from './targetModel'
import { ZoneShield } from './ZoneNode'

type Props = {
  /** Everything the map can be filtered on: zones, Proxmox nodes, clusters of a shared policy, running guests. */
  items: readonly FilterItem[]
  /** What is picked, in the order it was. */
  picked: readonly FilterItem[]
  onPicked: (next: FilterItem[]) => void
  zonesById: Map<string, MicrosegZone>
  /** The only pick when it is one guest: the "Targeting" chip beside the field stands for it. */
  target: TargetGuest | null
  /** The "Targeting" chip was clicked: show the panel of the guest again. */
  onShowPanel: () => void
  /** The guest's pending observed flows, said in the chip (absent: the name alone). */
  observedCount?: number
  /** "With what they exchange with": offered with two picks or more (one pick alone always shows it). */
  peers: boolean
  onPeers: (next: boolean) => void
  /** Names a cluster; given only when the policy is shared: a guest or a node then shows its cluster chip after its glyph. */
  clusterName?: (id: string) => string
  /** The status of a Proxmox node when the page knows it (its glyph then carries the status dot). */
  nodeStatus?: (connectionId: string, node: string) => string | undefined
}

const optionKey = (o: FilterItem) => o.id
/** The field on one line: wider once it holds two picks or more (two chips and the "+N" of the others fit). */
const FIELD_WIDTH = 280
const FIELD_WIDTH_PICKED = 400
/** The height of the small outlined field on one line: the room the toolbar keeps for it, open or not. */
const FIELD_HEIGHT = 40
const sameItem = (a: FilterItem, b: FilterItem) => a.id === b.id

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

/** The zone of a guest option: its dot and name, or "no zone". */
function ZoneOf({ zone, none }: { zone: MicrosegZone | undefined; none: string }) {
  return (
    <Box component='span' sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, minWidth: 0, flex: '0 1 auto' }}>
      <Box component='span' aria-hidden sx={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, bgcolor: zone ? zone.color || 'text.disabled' : 'transparent', border: zone ? 0 : '1px dashed', borderColor: 'text.disabled' }} />
      <Typography component='span' noWrap variant='caption' color='text.secondary'>{zone?.name ?? none}</Typography>
    </Box>
  )
}

/** The glyph of a cluster (or standalone node), from what the page read of the connection. */
function ClusterGlyph({ connectionId }: Readonly<{ connectionId: string }>) {
  return <ConnectionGlyph kind={useConnectionKind(connectionId)} />
}

/** The glyph of an item, the same in its option and in its chip: every row and every pick starts with it. */
function ItemGlyph({ item, nodeStatus }: Readonly<{ item: FilterItem; nodeStatus?: Props['nodeStatus'] }>) {
  const theme = useTheme()
  if (item.kind === 'guest') return <StatusIcon type='vm' vmType={item.guest.type} status={item.guest.status} />
  if (item.kind === 'zone') return <ZoneShield color={item.zone.color || 'currentColor'} state={item.zone.state} />
  if (item.kind === 'cluster') return <ClusterGlyph connectionId={item.cluster.id} />
  return <NodeGlyph status={nodeStatus?.(item.connectionId, item.node)} dark={theme.palette.mode === 'dark'} dotBorder={theme.palette.background.paper} />
}

/**
 * The filter of the map: a search over the zones, the Proxmox nodes, the clusters of a shared policy and the running
 * guests (name, VMID, address), each option on one line under the heading of its kind. Every pick is added to the
 * field as a chip: the map keeps only what is picked, until a chip is removed or the field cleared. One pick alone is
 * shown with what it exchanges with; two picks or more with the flows between them, and "With what they exchange
 * with" adds the rest of their flows. One guest alone is the target the map always had: the map stays whole, the
 * "Targeting" chip beside the field reminds the lock and shows the panel of the guest again on a click.
 */
export default function TargetPicker({ items, picked, onPicked, zonesById, target, onShowPanel, observedCount, peers, onPeers, clusterName, nodeStatus }: Readonly<Props>) {
  const t = useTranslations('microsegPilot.overview.target')
  const zoneName = (c: TargetGuest) => (c.zoneId ? zonesById.get(c.zoneId)?.name : undefined) ?? t('noZone')
  const [query, setQuery] = useState('')
  const matching = useMemo(() => items.filter(i => i.kind === 'guest' && matchesItem(i, query)).length, [items, query])
  const hint = matching > MAX_OPTIONS ? t('more', { shown: MAX_OPTIONS, count: matching }) : null
  const value = useMemo(() => [...picked], [picked])
  // Open (the focus in it), the field shows every pick, on as many lines as they take, over the map below: the toolbar
  // keeps one line and does not move. Closed, it is one line: two chips and the "+N" of the others.
  const [open, setOpen] = useState(false)
  const width = picked.length > 1 ? FIELD_WIDTH_PICKED : FIELD_WIDTH
  const options = useMemo(() => [...items], [items])

  const aria = (o: FilterItem) => {
    if (o.kind === 'guest') return t('option', { name: o.guest.name, vmid: o.guest.vmid, zone: zoneName(o.guest) })
    if (o.kind === 'zone') return t('optionZone', { name: o.zone.name })
    if (o.kind === 'node') return t('optionNode', { name: o.node, count: o.guests })
    return t('optionCluster', { name: o.cluster.name, count: o.guests })
  }
  /** What follows the glyph and the name of an option, on its line. */
  const details = (o: FilterItem): ReactNode => {
    if (o.kind === 'guest') {
      return (
        <>
          <Typography noWrap variant='caption' color='text.secondary' sx={{ flexShrink: 0 }}>{o.guest.vmid}</Typography>
          <Box sx={{ flex: 1 }} />
          <ZoneOf zone={o.guest.zoneId ? zonesById.get(o.guest.zoneId) : undefined} none={t('noZone')} />
        </>
      )
    }
    if (o.kind === 'zone') return null
    return (
      <>
        <Box sx={{ flex: 1 }} />
        <Typography noWrap variant='caption' color='text.secondary' sx={{ flexShrink: 0 }}>{t('guests', { count: o.guests })}</Typography>
      </>
    )
  }
  const clusterOf = (o: FilterItem) => {
    if (!clusterName) return null
    if (o.kind === 'guest') return <ClusterChip connectionId={o.guest.connectionId} name={clusterName(o.guest.connectionId)} compact />
    if (o.kind === 'node') return <ClusterChip connectionId={o.connectionId} name={clusterName(o.connectionId)} compact />
    return null
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      <HintContext.Provider value={hint}>
        <Box
          onFocus={() => setOpen(true)}
          onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false) }}
          sx={{ position: 'relative', width, height: FIELD_HEIGHT, flexShrink: 0 }}
        >
        <Autocomplete
          multiple
          size='small'
          sx={theme => ({
            position: 'absolute', top: 0, left: 0, width,
            // Above the map and its overlays, under the list of options (a popper) and the tooltips.
            zIndex: open ? theme.zIndex.appBar : 'auto',
            '& .MuiAutocomplete-inputRoot': {
              flexWrap: open ? 'wrap' : 'nowrap', overflow: 'hidden', bgcolor: 'background.paper',
              boxShadow: open && picked.length > 2 ? theme.shadows[4] : 'none',
            },
          })}
          options={options}
          value={value}
          onChange={(_e, next) => onPicked(next)}
          inputValue={query}
          onInputChange={(_e, next, reason) => { if (reason !== 'reset') setQuery(next) }}
          filterOptions={all => searchItems(all, query)}
          filterSelectedOptions
          disableCloseOnSelect
          limitTags={2}
          getLimitTagsText={more => `+${more}`}
          groupBy={o => o.kind}
          getOptionLabel={itemName}
          getOptionKey={optionKey}
          isOptionEqualToValue={sameItem}
          slots={{ paper: HintPaper }}
          noOptionsText={t('noOptions')}
          clearText={t('clear')}
          openText={t('openList')}
          closeText={t('closeList')}
          renderGroup={group => (
            <Box component='li' key={group.key} sx={{ listStyle: 'none' }}>
              <Typography variant='caption' color='text.secondary' sx={{ display: 'block', px: 2, pt: 1, pb: 0.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>{t(`group.${group.group}`)}</Typography>
              <Box component='ul' sx={{ p: 0, m: 0 }}>{group.children}</Box>
            </Box>
          )}
          renderOption={(props, o) => {
            const { key, ...rest } = props as HTMLAttributes<HTMLLIElement> & { key: Key }
            return (
              <Box component='li' key={key} {...rest} data-kind={o.kind} aria-label={aria(o)} sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, whiteSpace: 'nowrap' }}>
                <ItemGlyph item={o} nodeStatus={nodeStatus} />
                {clusterOf(o)}
                <Typography noWrap sx={{ flex: '0 1 auto', minWidth: 0 }}>{itemName(o)}</Typography>
                {details(o)}
              </Box>
            )
          }}
          renderValue={(shown, getItemProps) => shown.map((o, index) => {
            const { key, ...chip } = getItemProps({ index })
            return (
              <Chip
                key={key}
                {...chip}
                size='small'
                variant='outlined'
                data-kind={o.kind}
                icon={<Box component='span' sx={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, '&&': { width: 'auto', height: 'auto', ml: 0.75 } }}><ItemGlyph item={o} nodeStatus={nodeStatus} /></Box>}
                label={itemName(o)}
                sx={{ maxWidth: 120, flexShrink: 0 }}
              />
            )
          })}
          renderInput={params => (
            <TextField
              {...params}
              placeholder={picked.length > 0 ? t('placeholderMore') : t('placeholder')}
              slotProps={{ htmlInput: { ...params.inputProps, 'aria-label': t('label') } }}
            />
          )}
        />
        </Box>
      </HintContext.Provider>
      {target && (
        <Tooltip title={t('chipHint', { name: target.name })}>
          <Chip
            size='small'
            color='primary'
            variant='outlined'
            icon={<i className='ri-focus-3-line' />}
            label={observedCount === undefined ? t('chip', { name: target.name }) : t('chipFlows', { name: target.name, count: observedCount })}
            onClick={onShowPanel}
            onDelete={() => onPicked([])}
            sx={{ minWidth: 0, maxWidth: 220 }}
          />
        </Tooltip>
      )}
      {picked.length > 1 && (
        <Tooltip title={t('peersHint')} describeChild>
          <FormControlLabel
            sx={{ mr: 0.5, ml: 0, flexShrink: 0 }}
            control={<Checkbox size='small' checked={peers} onChange={(_e, checked) => onPeers(checked)} sx={{ p: 0.5 }} />}
            label={<Typography component='span' variant='body2' noWrap>{t('peers')}</Typography>}
          />
        </Tooltip>
      )}
    </Box>
  )
}
