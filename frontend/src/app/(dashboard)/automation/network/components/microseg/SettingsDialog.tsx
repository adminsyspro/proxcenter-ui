'use client'

import { useMemo, useState } from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { microsegApi } from '@/lib/microseg/api'
import type { MicrosegPolicy } from '@/lib/microseg/types'

import { DialogErrorLine, ONE_LINE_SX, isVersionConflict, useDialogAction } from './dialogParts'
import RemoveDialog from './RemoveDialog'
import TypedConfirmDialog from './TypedConfirmDialog'
import SettingsFields, { SectionTitle } from './SettingsFields'
import {
  SETTING_UNITS, changedUpdate, formFromSettings, validateSettingsForm, type SettingNumberKey, type SettingsForm,
} from './settingsModel'
import type { TrackedRun } from './microsegTabTypes'

type Props = {
  connectionId: string
  /** Typed to confirm the removal. */
  connectionName: string
  policy: MicrosegPolicy
  reloadPolicy: () => Promise<unknown>
  startRun: (run: TrackedRun) => void
  onClose: () => void
}

/**
 * The settings of the micro-segmentation of a connection (tag prefix, load on
 * Proxmox, observation, notifications) and its removal. Saves only the fields
 * that changed since the dialog opened; a 409 reloads the draft and keeps the
 * input, so the same save can be sent again against the new version.
 */
export default function SettingsDialog({ connectionId, connectionName, policy, reloadPolicy, startRun, onClose }: Props) {
  const t = useTranslations('microsegPilot.settings')
  const tc = useTranslations('common')
  const api = useMemo(() => microsegApi(connectionId), [connectionId])
  const save = useDialogAction()
  const removal = useDialogAction()

  // The form at opening: what "changed" is measured against, even if the draft moves meanwhile.
  const [baseline] = useState(() => formFromSettings(policy.policy.tag_prefix, policy.policy.settings))
  const [form, setForm] = useState<SettingsForm>(baseline)
  const [removing, setRemoving] = useState(false)
  const [confirmingPrefix, setConfirmingPrefix] = useState(false)

  const problems = validateSettingsForm(form, baseline)
  const firstProblem = Object.entries(problems)[0]
  const update = changedUpdate(baseline, form)

  const problemText = () => {
    if (!firstProblem) return null
    const [field, problem] = firstProblem
    const values: Record<string, string | number> = { ...problem.values }
    if (problem.key === 'range') {
      values.label = t(`fields.${field}`)
      values.unit = t(`unitsLong.${SETTING_UNITS[field as SettingNumberKey]}`)
    }
    return t(`validation.${problem.key}`, values)
  }

  // Zones find their members by tag: other tags would take every guest out of its zone at the next apply.
  const prefixChanged = update?.tag_prefix !== undefined && policy.zones.length > 0

  const submit = async () => {
    if (!update || firstProblem) return
    setConfirmingPrefix(false)
    const ok = await save.run(async () => {
      try {
        await api.savePolicy({ version: policy.version, ...update })
      } catch (e) {
        if (isVersionConflict(e)) await reloadPolicy().catch(() => undefined)
        throw e
      }
    })
    if (!ok) return
    await reloadPolicy().catch(() => undefined)
    onClose()
  }

  const remove = async () => {
    const ok = await removal.run(async () => {
      const started = await api.startRemove()
      startRun({ runId: started.run_id, kind: 'remove', label: connectionName, runningText: t('remove.running', { label: connectionName }) })
    })
    if (ok) onClose()
  }

  const busy = save.busy
  const shown = problemText()
  const errorLine = shown || save.error

  return (
    <>
      <Dialog open onClose={busy ? undefined : onClose} maxWidth='sm' fullWidth scroll='paper' aria-labelledby='microseg-settings-title'>
        <DialogTitle id='microseg-settings-title' sx={ONE_LINE_SX}>{t('title')}</DialogTitle>
        <DialogContent dividers>
          <SettingsFields
            form={form}
            problems={problems}
            busy={busy}
            prefixWarning={prefixChanged}
            onChange={(key, value) => setForm(prev => ({ ...prev, [key]: value }))}
          />
          <SectionTitle>{t('sections.removal')}</SectionTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minHeight: 44, minWidth: 0 }}>
            <Tooltip title={t('remove.hint')}>
              <Typography noWrap sx={{ flex: '1 1 0', minWidth: 0 }}>{t('remove.row')}</Typography>
            </Tooltip>
            <Button
              size='small'
              color='error'
              variant='outlined'
              disabled={busy}
              onClick={() => { removal.reset(); setRemoving(true) }}
              sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
            >
              {t('remove.button')}
            </Button>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {errorLine ? <DialogErrorLine message={errorLine} /> : null}
          </Box>
          <Button onClick={onClose} disabled={busy}>{tc('cancel')}</Button>
          <Button onClick={() => (prefixChanged ? setConfirmingPrefix(true) : void submit())} variant='contained' disabled={busy || !update || !!firstProblem}>{tc('save')}</Button>
        </DialogActions>
      </Dialog>
      {confirmingPrefix && (
        <TypedConfirmDialog
          title={t('prefixChange.title')}
          lines={[t('prefixChange.body')]}
          inputLabel={t('prefixChange.typeName', { prefix: form.tagPrefix })}
          expected={form.tagPrefix}
          confirmLabel={t('prefixChange.confirm')}
          onConfirm={() => void submit()}
          onCancel={() => setConfirmingPrefix(false)}
        />
      )}
      {removing && (
        <RemoveDialog
          connectionName={connectionName}
          busy={removal.busy}
          error={removal.error}
          onConfirm={() => void remove()}
          onCancel={() => setRemoving(false)}
        />
      )}
    </>
  )
}
