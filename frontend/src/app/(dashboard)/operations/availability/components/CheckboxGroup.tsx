'use client'

import { useMemo, useState, type ReactNode } from 'react'

import { useTranslations } from 'next-intl'
import { Box, Checkbox, FormControlLabel, InputAdornment, TextField, Typography } from '@mui/material'

import { GlyphIcon } from './RowGlyph'

export interface CheckboxItem {
  key: string
  label: string
  secondary?: string
  /** A Remix icon class, or PROXMOX for the Proxmox logo. */
  icon?: string
  /** A ready glyph shown instead of `icon`, a guest icon with its status dot. */
  glyph?: ReactNode
  /** The heading the item is listed under, a connection for a guest; items of one group must be adjacent. */
  group?: string
}

interface Props {
  title: string
  items: CheckboxItem[]
  selected: ReadonlySet<string>
  onChange: (next: Set<string>) => void
  emptyText: string
  searchable?: boolean
  /** The title stays the accessible name of the search but is not shown (a tab already names the list). */
  hideTitle?: boolean
  /** Fixed height of the list, so that switching between lists does not resize a dialog. */
  listHeight?: number
  /** The icon of a group heading: a Remix icon class, or PROXMOX for the Proxmox logo. */
  groupIcon?: string
}

/** Rows shown at once: a long inventory is narrowed with the search instead of rendered whole. */
export const MAX_SHOWN = 200

/** The items in runs of one group, in their order. */
function runsOf(items: readonly CheckboxItem[]): { group: string; items: CheckboxItem[] }[] {
  const runs: { group: string; items: CheckboxItem[] }[] = []

  for (const i of items) {
    const group = i.group ?? ''
    const last = runs[runs.length - 1]

    if (last && last.group === group) last.items.push(i)
    else runs.push({ group, items: [i] })
  }

  return runs
}

/**
 * A fixed list of choices as check boxes, with an "All" box that is checked,
 * half checked or empty. Items that carry a group are listed under its
 * heading, a divider between two groups, the heading box ticking the whole
 * group as the search leaves it.
 */
export default function CheckboxGroup({ title, items, selected, onChange, emptyText, searchable, hideTitle, listHeight, groupIcon }: Readonly<Props>) {
  const t = useTranslations('availability')
  const [query, setQuery] = useState('')

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()

    return q ? items.filter(i => `${i.label} ${i.secondary ?? ''} ${i.group ?? ''}`.toLowerCase().includes(q)) : items
  }, [items, query])

  const shown = visible.slice(0, MAX_SHOWN)
  const ticked = visible.filter(i => selected.has(i.key)).length
  const all = visible.length > 0 && ticked === visible.length
  const some = ticked > 0 && !all

  /** Ticks every item given, or clears them all when they all are ticked already. */
  const toggleMany = (list: readonly CheckboxItem[]) => {
    const clear = list.every(i => selected.has(i.key))
    const next = new Set(selected)

    for (const i of list) {
      if (clear) next.delete(i.key)
      else next.add(i.key)
    }

    onChange(next)
  }

  const toggle = (key: string) => {
    const next = new Set(selected)

    if (next.has(key)) next.delete(key)
    else next.add(key)
    onChange(next)
  }

  const grouped = items.some(i => i.group !== undefined)

  const renderItem = (i: CheckboxItem) => (
    <FormControlLabel
      key={i.key}
      control={<Checkbox size='small' checked={selected.has(i.key)} onChange={() => toggle(i.key)} />}
      label={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {i.glyph ?? (i.icon && <GlyphIcon icon={i.icon} />)}
          <Typography variant='body2' component='span'>{i.label}</Typography>
          {i.secondary && <Typography variant='caption' color='text.secondary' component='span'>{i.secondary}</Typography>}
        </Box>
      }
    />
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      {!hideTitle && <Typography variant='subtitle2'>{title}</Typography>}
      {searchable && (
        <TextField
          size='small'
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('dialog.search')}
          slotProps={{
            htmlInput: { 'aria-label': `${title}: ${t('dialog.search')}` },
            input: { startAdornment: <InputAdornment position='start'><i className='ri-search-line' aria-hidden='true' /></InputAdornment> },
          }}
        />
      )}
      {items.length === 0 ? (
        <Typography variant='body2' color='text.secondary'>{emptyText}</Typography>
      ) : (
        <>
          <FormControlLabel
            label={t('dialog.all')}
            control={<Checkbox size='small' checked={all} indeterminate={some} onChange={() => toggleMany(visible)} disabled={visible.length === 0} />}
          />
          <Box sx={{ display: 'flex', flexDirection: 'column', ...(listHeight ? { height: listHeight } : { maxHeight: 200 }), overflowY: 'auto', pl: 2, '& .MuiCheckbox-root': { py: 0.5 } }}>
            {grouped
              ? runsOf(shown).map((run, n) => {
                const members = visible.filter(i => (i.group ?? '') === run.group)
                const ticked = members.filter(i => selected.has(i.key)).length

                return (
                  <Box key={`group:${run.group}`} sx={n > 0 ? { borderTop: 1, borderColor: 'divider', mt: 1, pt: 1 } : undefined}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          size='small'
                          checked={ticked === members.length}
                          indeterminate={ticked > 0 && ticked < members.length}
                          onChange={() => toggleMany(members)}
                          slotProps={{ input: { 'aria-label': t('dialog.allOf', { group: run.group }) } }}
                        />
                      }
                      label={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {groupIcon && <GlyphIcon icon={groupIcon} />}
                          <Typography variant='body2' component='span' sx={{ fontWeight: 600 }}>{run.group}</Typography>
                          <Typography variant='caption' color='text.secondary' component='span'>{t('dialog.groupCount', { ticked, total: members.length })}</Typography>
                        </Box>
                      }
                    />
                    <Box sx={{ display: 'flex', flexDirection: 'column', pl: 3 }}>{run.items.map(renderItem)}</Box>
                  </Box>
                )
              })
              : shown.map(renderItem)}
          </Box>
          {visible.length > shown.length && (
            <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>
              {t('dialog.more', { count: visible.length - shown.length })}
            </Typography>
          )}
        </>
      )}
    </Box>
  )
}
