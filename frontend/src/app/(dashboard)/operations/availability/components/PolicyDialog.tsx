'use client'

import { useEffect, useMemo, useState } from 'react'

import { useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  InputAdornment,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'

import { GuestGlyph } from '@/components/automation/drs/glyphs'

import { useInventoryOptions, useMeasuredConnections } from '../hooks/useSlaLists'

import CheckboxGroup, { type CheckboxItem } from './CheckboxGroup'
import { guestKey } from './inventoryOptions'
import { PROXMOX } from './RowGlyph'
import { errorCodeOf, slaRequest, TARGET_MAX, TARGET_MIN, type PolicyItem } from './slaApi'

interface Props {
  open: boolean
  /** The policy to edit, null to create one. */
  policy: PolicyItem | null
  defaultTarget: number
  onClose: () => void
  onSaved: () => void
}

type ScopeTab = 'guests' | 'tags' | 'pools'

// Height of the list of each scope tab: the dialog keeps its size from one tab to the next.
const LIST_HEIGHT = 260

/** Create or edit a policy: name, target and the guests it covers (ticked, by tag or by pool). */
export default function PolicyDialog({ open, policy, defaultTarget, onClose, onSaved }: Readonly<Props>) {
  const t = useTranslations('availability')
  const { options, error: inventoryError, isLoading: inventoryLoading } = useInventoryOptions(open)
  const { data: measuredData, error: measuredError, isLoading: measuredLoading } = useMeasuredConnections(open)
  const isLoading = inventoryLoading || measuredLoading

  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [guests, setGuests] = useState<Set<string>>(new Set())
  const [tags, setTags] = useState<Set<string>>(new Set())
  const [pools, setPools] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<ScopeTab>('guests')

  useEffect(() => {
    if (!open) return

    setName(policy?.name ?? '')
    setTarget(String(policy?.target ?? defaultTarget))
    setEnabled(policy?.enabled ?? true)
    setGuests(new Set((policy?.guests ?? []).map(g => guestKey(g.connectionId, g.vmid))))
    setTags(new Set(policy?.tags ?? []))
    setPools(new Set(policy?.pools ?? []))
    setError(null)
    setBusy(false)
    setTab('guests')
  }, [open, policy, defaultTarget])

  const dotBorder = useTheme().palette.background.paper

  const guestItems = useMemo<CheckboxItem[]>(() => {
    // Only the guests of a measured connection are offered; one ticked earlier stays.
    const measured = new Set(measuredData?.connectionIds ?? [])
    const ticked = new Set((policy?.guests ?? []).map(g => guestKey(g.connectionId, g.vmid)))
    const offered = options.guests.filter(g => measured.has(g.connectionId) || ticked.has(g.key))
    const known = new Set(offered.map(g => g.key))
    const connectionNames = new Map(options.guests.map(g => [g.connectionId, g.connectionName]))
    const listed = offered.map(g => ({
      key: g.key,
      label: g.name ?? t(g.type === 'lxc' ? 'policies.guestFallbackCt' : 'policies.guestFallbackVm', { vmid: g.vmid }),
      secondary: String(g.vmid),
      glyph: <GuestGlyph type={g.type} status={g.status} dotBorder={dotBorder} />,
      group: g.connectionName,
    }))

    // A guest ticked earlier but no longer listed stays visible, so saving does not drop it unseen.
    const missing = (policy?.guests ?? [])
      .filter(g => !known.has(guestKey(g.connectionId, g.vmid)))
      .map(g => ({
        key: guestKey(g.connectionId, g.vmid),
        label: t('policies.guestFallbackVm', { vmid: g.vmid }),
        glyph: <GuestGlyph dotBorder={dotBorder} />,
        group: connectionNames.get(g.connectionId) ?? g.connectionId,
      }))

    // One run per connection, guests by name inside it.
    return [...listed, ...missing].sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label))
  }, [options.guests, measuredData, policy, t, dotBorder])

  const labelItems = (list: string[], kept: string[]): CheckboxItem[] =>
    [...new Set([...list, ...kept])].sort((a, b) => a.localeCompare(b)).map(v => ({ key: v, label: v }))

  const tagItems = useMemo(() => labelItems(options.tags, policy?.tags ?? []), [options.tags, policy])
  const poolItems = useMemo(() => labelItems(options.pools, policy?.pools ?? []), [options.pools, policy])

  const targetNumber = Number(target.replace(',', '.'))
  const targetValid = target.trim() !== '' && Number.isFinite(targetNumber) && targetNumber >= TARGET_MIN && targetNumber <= TARGET_MAX
  const canSave = name.trim() !== '' && targetValid && !busy

  const save = async () => {
    setBusy(true)
    setError(null)

    try {
      const body = {
        name: name.trim(),
        target: targetNumber,
        enabled,
        guests: [...guests].map(k => {
          const i = k.lastIndexOf(':')

          return { connectionId: k.slice(0, i), vmid: Number(k.slice(i + 1)) }
        }),
        tags: [...tags],
        pools: [...pools],
      }

      await (policy ? slaRequest(`/api/v1/sla/policies/${policy.id}`, 'PUT', body) : slaRequest('/api/v1/sla/policies', 'POST', body))
      onSaved()
    } catch (e) {
      setError(t(`errors.${errorCodeOf(e)}`))
      setBusy(false)
    }
  }

  const lists: Record<ScopeTab, { items: CheckboxItem[]; selected: Set<string>; onChange: (next: Set<string>) => void; empty: string }> = {
    guests: { items: guestItems, selected: guests, onChange: setGuests, empty: t('dialog.noGuests') },
    tags: { items: tagItems, selected: tags, onChange: setTags, empty: t('dialog.noTags') },
    pools: { items: poolItems, selected: pools, onChange: setPools, empty: t('dialog.noPools') },
  }

  let scopeBody
  if (inventoryError || measuredError) scopeBody = <Alert severity='warning'>{t('dialog.inventoryError')}</Alert>
  else if (isLoading) scopeBody = <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: LIST_HEIGHT }}><CircularProgress size={20} aria-label={t('loading')} /></Box>
  else {
    const list = lists[tab]

    scopeBody = (
      <CheckboxGroup
        key={tab}
        title={t(`dialog.${tab}`)}
        hideTitle
        items={list.items}
        selected={list.selected}
        onChange={list.onChange}
        emptyText={list.empty}
        searchable
        listHeight={LIST_HEIGHT}
        groupIcon={tab === 'guests' ? PROXMOX : undefined}
      />
    )
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth='md' fullWidth>
      <DialogTitle>{t(policy ? 'dialog.editTitle' : 'dialog.createTitle')}</DialogTitle>
      <DialogContent sx={{ pt: '20px !important', display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        {error && <Alert severity='error'>{error}</Alert>}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 180px auto' }, gap: 2, alignItems: 'start' }}>
          <TextField
            size='small'
            fullWidth
            required
            label={t('dialog.name')}
            value={name}
            onChange={e => setName(e.target.value)}
            slotProps={{ htmlInput: { maxLength: 120 } }}
          />
          <TextField
            size='small'
            fullWidth
            required
            type='number'
            label={t('dialog.target')}
            value={target}
            onChange={e => setTarget(e.target.value)}
            error={target.trim() !== '' && !targetValid}
            helperText={t('dialog.targetHelp', { min: TARGET_MIN, max: TARGET_MAX })}
            slotProps={{
              htmlInput: { min: TARGET_MIN, max: TARGET_MAX, step: 0.001 },
              input: { endAdornment: <InputAdornment position='end'>%</InputAdornment> },
            }}
          />
          <FormControlLabel
            sx={{ mt: 0.5, ml: 0 }}
            label={t('dialog.enabled')}
            control={<Switch size='small' checked={enabled} onChange={e => setEnabled(e.target.checked)} />}
          />
        </Box>
        <Box>
          <Typography variant='subtitle2'>{t('dialog.scopeTitle')}</Typography>
          <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>{t('dialog.scopeHelp')}</Typography>
          <Tabs value={tab} onChange={(_, next: ScopeTab) => setTab(next)} sx={{ borderBottom: 1, borderColor: 'divider', mb: 1.5, minHeight: 40 }}>
            {(['guests', 'tags', 'pools'] as const).map(id => (
              <Tab key={id} value={id} sx={{ minHeight: 40 }} label={t('dialog.tabCount', { label: t(`dialog.${id}`), count: lists[id].selected.size })} />
            ))}
          </Tabs>
          {scopeBody}
        </Box>
        <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>{t('dialog.membershipNote')} {t('dialog.measuredOnly')}</Typography>
      </DialogContent>
      <DialogActions>
        <Typography variant='body2' color='text.secondary' sx={{ mr: 'auto', pl: 1 }}>
          {t('dialog.selection', { guests: guests.size, tags: tags.size, pools: pools.size })}
        </Typography>
        <Button onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button variant='contained' onClick={save} disabled={!canSave}>{t('common.save')}</Button>
      </DialogActions>
    </Dialog>
  )
}
