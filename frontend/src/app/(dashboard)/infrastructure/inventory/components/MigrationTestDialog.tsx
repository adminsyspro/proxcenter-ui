'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'

import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Select, TextField, Typography } from '@mui/material'

import { SMALL_SELECT_SX } from '@/components/settings/destinations/DestinationDialogParts'
import { MIGRATION_TEST_MAX_SEC_DEFAULT } from '@/lib/migration/warm/migration-test-state'
import { formatBytes } from '@/utils/format'

import { postJobAction } from './jobAction'

interface TestOptions {
  storages: { id: string; type: string; availBytes: number }[]
  bridges: string[]
  nodeAvailableMemoryMB: number | null
  maxSecChoices: number[]
  maxSecDefault: number
}

/** One setting per line: its label on the left, its control on the right, aligned with the other lines. */
function Line({ id, label, children }: Readonly<{ id: string; label: string; children: ReactNode }>) {
  return (
    <Box data-testid={`test-line-${id}`} sx={{ display: 'grid', gridTemplateColumns: '170px 1fr', alignItems: 'center', gap: 2 }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      {children}
    </Box>
  )
}

/**
 * The settings of a test of a waiting warm migration (migration-test.ts):
 * where the overlays go, which network the test VM gets, when it stops.
 * The node's options are read when the dialog opens; nothing starts before
 * "Start test".
 */
export default function MigrationTestDialog({ open, jobId, name, node, onClose, onStarted }: Readonly<{
  open: boolean
  jobId: string
  name: string
  node: string
  onClose: () => void
  onStarted?: () => void
}>) {
  const t = useTranslations()
  const [options, setOptions] = useState<TestOptions | null>(null)
  const [storage, setStorage] = useState('')
  const [bridge, setBridge] = useState('')
  const [vlanTag, setVlanTag] = useState('')
  const [maxSec, setMaxSec] = useState(MIGRATION_TEST_MAX_SEC_DEFAULT)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let gone = false
    setOptions(null)
    setError(null)
    fetch(`/api/v1/migrations/${encodeURIComponent(jobId)}/test`)
      .then(async res => {
        const payload = await res.json().catch(() => null)
        if (!res.ok) throw new Error(payload?.error || `HTTP ${res.status}`)
        return payload.data as TestOptions
      })
      .then(d => {
        if (gone) return
        setOptions(d)
        setStorage(d.storages[0]?.id ?? '')
        setBridge('')
        setVlanTag('')
        setMaxSec(d.maxSecDefault)
      })
      .catch(e => { if (!gone) setError(e?.message || String(e)) })
    return () => { gone = true }
  }, [open, jobId])

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      await postJobAction(`/api/v1/migrations/${encodeURIComponent(jobId)}/test`, {
        storage, bridge: bridge || null, vlanTag: bridge && vlanTag ? Number(vlanTag) : null, maxSec,
      })
      onStarted?.()
      onClose()
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const k = (key: string, values?: Record<string, string | number>) => t(`inventoryPage.esxiMigration.${key}`, values)
  const noStorage = options !== null && options.storages.length === 0
  const ram = options?.nodeAvailableMemoryMB
  const info = ram ? `${k('testInfo')} ${k('testInfoRam', { node, free: formatBytes(ram * 1048576, 1) })}` : k('testInfo')

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className="ri-flask-line" />
        {k('testDialogTitle', { name })}
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: '8px !important' }}>
        {options === null && !error && <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={24} /></Box>}
        {options !== null && (
          <>
            {noStorage
              ? <Alert severity="warning">{k('testNoStorage', { node })}</Alert>
              : (
                <Line id="storage" label={k('testOverlayStorage')}>
                  <Select size="small" value={storage} onChange={e => setStorage(String(e.target.value))} sx={SMALL_SELECT_SX}>
                    {options.storages.map(s => (
                      <MenuItem key={s.id} value={s.id}>{k('testStorageOption', { storage: s.id, free: formatBytes(s.availBytes, 1) })}</MenuItem>
                    ))}
                  </Select>
                </Line>
              )}
            <Line id="network" label={k('testNetwork')}>
              <Select size="small" value={bridge} displayEmpty onChange={e => setBridge(String(e.target.value))} sx={SMALL_SELECT_SX}>
                <MenuItem value="">{k('testNoNetwork')}</MenuItem>
                {options.bridges.map(b => <MenuItem key={b} value={b}>{b}</MenuItem>)}
              </Select>
            </Line>
            {bridge && (
              <Line id="vlan" label={k('testVlanTag')}>
                <TextField size="small" type="number" value={vlanTag} onChange={e => setVlanTag(e.target.value)} slotProps={{ htmlInput: { min: 1, max: 4094 } }} />
              </Line>
            )}
            <Line id="stop" label={k('testStopAfter')}>
              <Select size="small" value={maxSec} onChange={e => setMaxSec(Number(e.target.value))} sx={SMALL_SELECT_SX}>
                {options.maxSecChoices.map(sec => <MenuItem key={sec} value={sec}>{k('testStopAfterHours', { hours: sec / 3600 })}</MenuItem>)}
              </Select>
            </Line>
            <Typography variant="body2" color="text.secondary">{info}</Typography>
            {bridge && <Alert severity="warning">{k('testBridgeWarning')}</Alert>}
          </>
        )}
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          onClick={start}
          disabled={busy || !options || noStorage || !storage}
          startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <i className="ri-play-line" />}
        >
          {k('testStartAction')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
