'use client'

import { useState } from 'react'

import { useTranslations } from 'next-intl'
import { mutate } from 'swr'
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'

import { useSWRFetch } from '@/hooks/useSWRFetch'

import CheckboxGroup, { type CheckboxItem } from './CheckboxGroup'
import { PROXMOX } from './RowGlyph'

export const SETTINGS_API = '/api/v1/availability/settings'

// The list keeps its height whether it holds two connections or forty.
const LIST_HEIGHT = 280

/** What the page reads of the availability settings: who may change them, and what is measured. */
export function useMeasuredSettings() {
  // A tenant other than the provider gets a 404: no button, no retry.
  return useSWRFetch<{ measuredConnections?: string[]; policiesByConnection?: Record<string, string[]> }>(SETTINGS_API, { revalidateOnFocus: false, shouldRetryOnError: false })
}

// The views that depend on what is measured.
const refreshMeasured = () => Promise.all([
  mutate(SETTINGS_API),
  mutate(key => typeof key === 'string' && (key.startsWith('/api/v1/availability/overview') || key === '/api/v1/availability/measured')),
])

interface Props {
  open: boolean
  measured: readonly string[]
  /** The enabled policies that cover a guest of each connection. */
  policies: Readonly<Record<string, string[]>>
  onClose: () => void
}

/**
 * The connections the availability registry records, ticked by hand: none
 * until then. The page gives it a new key at each opening, so it starts from
 * what is measured.
 */
export default function MeasuredConnectionsDialog({ open, measured, policies, onClose }: Readonly<Props>) {
  const t = useTranslations('availability.measured')
  const { data, error: listError, isLoading } = useSWRFetch<{ data?: { id: string; name: string }[] }>(open ? '/api/v1/connections?type=pve' : null, { revalidateOnFocus: false })
  const [selected, setSelected] = useState<Set<string>>(() => new Set(measured))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const items: CheckboxItem[] = (data?.data ?? [])
    .map(c => ({ key: c.id, label: c.name, icon: PROXMOX }))
    .sort((a, b) => a.label.localeCompare(b.label))

  // A connection measured until now, unticked, while a policy covers its guests: they lose their figures.
  const dropped = items.filter(i => measured.includes(i.key) && !selected.has(i.key) && (policies[i.key]?.length ?? 0) > 0)

  const save = async () => {
    setBusy(true)
    setError(null)

    try {
      const res = await fetch(SETTINGS_API, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ measuredConnections: [...selected] }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => null)

        setError(t(body?.error === 'invalid_connections' ? 'invalidConnections' : 'saveError'))
        setBusy(false)

        return
      }

      await refreshMeasured()
      onClose()
    } catch {
      setError(t('saveError'))
      setBusy(false)
    }
  }

  let body
  if (listError) body = <Alert severity='warning'>{t('loadError')}</Alert>
  else if (isLoading) body = <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: LIST_HEIGHT }}><CircularProgress size={20} /></Box>
  else {
    body = (
      <CheckboxGroup
        title={t('title')}
        hideTitle
        items={items}
        selected={selected}
        onChange={setSelected}
        emptyText={t('empty')}
        searchable={items.length > 8}
        listHeight={items.length > 8 ? LIST_HEIGHT : undefined}
      />
    )
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth='sm' fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className='ri-settings-3-line' aria-hidden='true' />
        {t('title')}
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {error && <Alert severity='error'>{error}</Alert>}
        <Typography variant='body2' color='text.secondary'>{t('description')}</Typography>
        {body}
        {dropped.length > 0 && (
          <Alert severity='warning'>
            {dropped.map(i => (
              <Box key={i.key}>
                {t('unmeasureWarning', { connection: i.label, count: policies[i.key].length, policies: policies[i.key].join(', ') })}
              </Box>
            ))}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button
          variant='contained'
          onClick={save}
          disabled={busy || isLoading || Boolean(listError)}
          startIcon={busy ? <CircularProgress size={16} color='inherit' /> : undefined}
        >
          {t('save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
