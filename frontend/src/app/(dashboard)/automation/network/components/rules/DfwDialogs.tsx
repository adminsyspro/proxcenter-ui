'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, ListSubheader, MenuItem, Select, Stack, Tooltip, Typography } from '@mui/material'

import { SMALL_SELECT_SX } from '@/components/settings/destinations/DestinationDialogParts'
import { LOG_LEVELS } from '@/components/firewall/logLevels'
import type { DraftScope, ScopeOptions } from '@/lib/firewall/publishOps'

import { ONE_LINE_SX, OneLine } from '../microseg/dialogParts'
import { WriteTip, useMicrosegWrite } from '../microseg/microsegAccess'

/** A section a rule can go to: its scope and its name. */
export type SectionTarget = { key: string; label: string; scope: DraftScope; loaded: boolean }

/** A field of a dialog on one line: the label on the left, the control on the right. */
function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
      <Typography id={id} noWrap sx={{ flex: '0 0 40%', fontSize: 14, color: 'text.secondary' }}>{label}</Typography>
      <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Box>
  )
}

function TargetSelect({ id, value, onChange, targets }: { id: string; value: string; onChange: (v: string) => void; targets: SectionTarget[] }) {
  return (
    <Select size='small' fullWidth value={value} onChange={e => onChange(String(e.target.value))} sx={SMALL_SELECT_SX} inputProps={{ 'aria-labelledby': id }}>
      {targets.map(s => <MenuItem key={s.key} value={s.key} sx={ONE_LINE_SX}>{s.label}</MenuItem>)}
    </Select>
  )
}

export function MoveToSectionDialog({ open, count, targets, onClose, onMove }: {
  open: boolean
  count: number
  targets: SectionTarget[]
  onClose: () => void
  onMove: (target: SectionTarget) => void
}) {
  const t = useTranslations('microsegPilot.dfw')
  const tg = useTranslations()
  const [key, setKey] = useState('')
  const target = targets.find(s => s.key === key) ?? null
  return (
    <Dialog open={open} onClose={onClose} maxWidth='sm' fullWidth aria-labelledby='dfw-move-title'>
      <DialogTitle id='dfw-move-title' sx={ONE_LINE_SX}>{t('moveDialog.title', { count })}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Field label={t('moveDialog.target')} id='dfw-move-target'>
            <TargetSelect id='dfw-move-target' value={key} onChange={setKey} targets={targets} />
          </Field>
          <OneLine text={t('moveDialog.hint')} />
          {target && !target.loaded && <OneLine text={t('moveDialog.notRead')} color='warning.main' />}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{tg('common.cancel')}</Button>
        <Button variant='contained' disabled={!target || !target.loaded} onClick={() => target && onMove(target)}>{t('moveDialog.confirm')}</Button>
      </DialogActions>
    </Dialog>
  )
}

/** The scope a new rule goes to, on the first line of the rule editor: the cluster, the hosts, the guests shown. */
export function ScopePicker({ value, targets, onChange, reading }: { value: string; targets: SectionTarget[]; onChange: (key: string) => void; reading: boolean }) {
  const t = useTranslations('microsegPilot.dfw')
  const groups: [DraftScope['kind'], string][] = [['cluster', t('scope.cluster')], ['host', t('scope.hosts')], ['guest', t('scope.vms')]]
  return (
    <Box sx={{ mb: 2 }}>
      <Field label={t('ruleScope')} id='dfw-rule-scope'>
        <Select size='small' fullWidth value={value} onChange={e => onChange(String(e.target.value))} sx={SMALL_SELECT_SX} labelId='dfw-rule-scope'>
          {groups.flatMap(([kind, label]) => {
            const items = targets.filter(target => target.scope.kind === kind)
            if (items.length === 0) return []
            return [
              <ListSubheader key={`h-${kind}`}>{label}</ListSubheader>,
              ...items.map(target => <MenuItem key={target.key} value={target.key} sx={ONE_LINE_SX}>{target.label}</MenuItem>),
            ]
          })}
        </Select>
      </Field>
      {reading && <OneLine text={t('readingScope')} />}
    </Box>
  )
}

type OptionField = 'enable' | 'policy_in' | 'policy_out' | 'log_level_in' | 'log_level_out'

/** The options each scope has in Proxmox: a host has no default policy, the cluster no log level of its own. */
const FIELDS: Record<DraftScope['kind'], OptionField[]> = {
  cluster: ['enable', 'policy_in', 'policy_out'],
  host: ['enable', 'log_level_in', 'log_level_out'],
  guest: ['enable', 'policy_in', 'policy_out', 'log_level_in', 'log_level_out'],
}

const POLICIES = ['ACCEPT', 'DROP', 'REJECT']

export function ScopeOptionsDialog({ open, name, scope, current, locked = [], busy = false, onClose, onSave }: {
  open: boolean
  name: string
  scope: DraftScope
  /** The options as the draft shows them (read, then changed). */
  current: ScopeOptions
  /** Options the engine owns on this guest (its zone rules are there): shown, never changed here. */
  locked?: readonly string[]
  /** A publish is running: the draft takes no change until it ends. */
  busy?: boolean
  onClose: () => void
  onSave: (options: ScopeOptions) => void
}) {
  const t = useTranslations('microsegPilot.dfw')
  const tg = useTranslations()
  // A read-only user sees the options (firewall switch, default policies, log levels) but changes none of them.
  const { canWrite } = useMicrosegWrite()
  const [form, setForm] = useState<ScopeOptions>(current)
  const set = (field: OptionField, value: string) => setForm(prev => ({ ...prev, [field]: field === 'enable' ? Number(value) : value }))
  const choices = (field: OptionField): string[] => {
    if (field === 'enable') return ['1', '0']
    return field.startsWith('policy') ? POLICIES : [...LOG_LEVELS]
  }
  const label = (field: OptionField, value: string) => {
    if (field !== 'enable') return value
    return value === '1' ? t('optionsDialog.on') : t('optionsDialog.off')
  }
  return (
    <Dialog open={open} onClose={onClose} maxWidth='sm' fullWidth aria-labelledby='dfw-options-title'>
      <DialogTitle id='dfw-options-title' sx={ONE_LINE_SX}>{t('optionsDialog.title', { name })}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 1 }}>
          {FIELDS[scope.kind].map(field => {
            const engine = locked.includes(field)
            const select = (
              <Select size='small' fullWidth value={String(form[field] ?? '')} onChange={e => set(field, String(e.target.value))} sx={{ ...SMALL_SELECT_SX, width: '100%' }}
                disabled={!canWrite || engine} inputProps={{ 'aria-labelledby': `dfw-opt-${field}` }}>
                {choices(field).map(v => <MenuItem key={v} value={v}>{label(field, v)}</MenuItem>)}
              </Select>
            )
            return (
              <Field key={field} label={t(`optionsDialog.${field}`)} id={`dfw-opt-${field}`}>
                {engine
                  ? <Tooltip title={t('managedRule')}><span style={{ display: 'flex' }}>{select}</span></Tooltip>
                  : <WriteTip>{select}</WriteTip>}
              </Field>
            )
          })}
          <OneLine text={t('optionsDialog.hint')} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{tg('common.cancel')}</Button>
        <WriteTip>
          <Button variant='contained' disabled={!canWrite || busy} onClick={() => onSave(form)}>{tg('common.save')}</Button>
        </WriteTip>
      </DialogActions>
    </Dialog>
  )
}
