'use client'

import { useMemo, useState } from 'react'

import { useTranslations } from 'next-intl'
import { Box, Checkbox, FormControlLabel, InputAdornment, TextField, Typography } from '@mui/material'

export interface CheckboxItem {
  key: string
  label: string
  secondary?: string
  icon?: string
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
}

/** Rows shown at once: a long inventory is narrowed with the search instead of rendered whole. */
export const MAX_SHOWN = 200

/** A fixed list of choices as check boxes, with an "All" box that is checked, half checked or empty. */
export default function CheckboxGroup({ title, items, selected, onChange, emptyText, searchable, hideTitle, listHeight }: Props) {
  const t = useTranslations('availability')
  const [query, setQuery] = useState('')

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()

    return q ? items.filter(i => `${i.label} ${i.secondary ?? ''}`.toLowerCase().includes(q)) : items
  }, [items, query])

  const shown = visible.slice(0, MAX_SHOWN)
  const ticked = visible.filter(i => selected.has(i.key)).length
  const all = visible.length > 0 && ticked === visible.length
  const some = ticked > 0 && !all

  const toggleAll = () => {
    const next = new Set(selected)

    for (const i of visible) {
      if (all) next.delete(i.key)
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
            control={<Checkbox size='small' checked={all} indeterminate={some} onChange={toggleAll} disabled={visible.length === 0} />}
          />
          <Box sx={{ display: 'flex', flexDirection: 'column', ...(listHeight ? { height: listHeight } : { maxHeight: 200 }), overflowY: 'auto', pl: 2, '& .MuiCheckbox-root': { py: 0.5 } }}>
            {shown.map(i => (
              <FormControlLabel
                key={i.key}
                control={<Checkbox size='small' checked={selected.has(i.key)} onChange={() => toggle(i.key)} />}
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {i.icon && <i className={i.icon} aria-hidden='true' />}
                    <Typography variant='body2' component='span'>{i.label}</Typography>
                    {i.secondary && <Typography variant='caption' color='text.secondary' component='span'>{i.secondary}</Typography>}
                  </Box>
                }
              />
            ))}
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
