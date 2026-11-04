'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import {
  Box, Button, Chip, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Pagination,
  Slider, Stack, Tooltip, Typography,
} from '@mui/material'
import { useTranslations } from 'next-intl'

import { StatusIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'
import { MIGRATION_CHIP_COLORS, countBulkJobs, migrationChipTone, orderBulkJobs } from '@/app/(dashboard)/infrastructure/inventory/bulkJobList'
import { useToast } from '@/contexts/ToastContext'
import {
  BULK_POWER_PER_NODE_MAX, BULK_POWER_PER_NODE_MIN, bulkPowerMessage, bulkPowerSeverity, readPerNodePreference,
  runBulkGuestPower, writePerNodePreference, type BulkGuestStatus, type BulkPowerAction, type BulkPowerGuest,
} from '@/lib/inventory/bulkGuestPower'

// Power action on a hand-picked set of guests (roadmap#197): the operator
// confirms and sets how many tasks each host runs at once, then follows every
// guest until its Proxmox task ends. Closing the dialog leaves the batch
// running; its verdict then comes as a toast.

export type BulkPowerTarget = BulkPowerGuest & { name?: string; status?: string }

/** Icon and palette colour of each action, shared with the power menu. */
export const POWER_ACTION_LOOK: Record<BulkPowerAction, { icon: string; color: 'success' | 'warning' | 'info' | 'error' }> = {
  start: { icon: 'ri-play-fill', color: 'success' },
  shutdown: { icon: 'ri-shut-down-line', color: 'warning' },
  reboot: { icon: 'ri-restart-line', color: 'info' },
  stop: { icon: 'ri-stop-fill', color: 'error' },
}

const PAGE_SIZE = 8

/** The status a guest shows: the one its finished task gave it, else the one it had when picked. */
export function shownStatus(action: BulkPowerAction, row: { status: BulkGuestStatus }, before?: string): string | undefined {
  if (row.status !== 'completed') return before

  return action === 'start' || action === 'reboot' ? 'running' : 'stopped'
}

type Row = { vmid: string; index: number; status: BulkGuestStatus; error?: string; warning?: string }

function GuestLine({ action, guest, row }: { action: BulkPowerAction; guest: BulkPowerTarget; row: Row }) {
  const t = useTranslations()
  const [open, setOpen] = useState(false)
  const colors = MIGRATION_CHIP_COLORS[migrationChipTone(row.status)]
  const detail = row.error || row.warning

  return (
    <Box data-testid="bulk-power-row" sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ minHeight: 36, px: 1 }}>
        <StatusIcon type="vm" vmType={guest.type} status={shownStatus(action, row, guest.status)} size={16} />
        <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
          {guest.name || guest.vmid}
          <Box component="span" sx={{ color: 'text.secondary', ml: 0.75 }}>{guest.vmid} · {guest.node}</Box>
        </Typography>
        <Chip size="small" label={t(`bulkPower.status.${row.status}`)} sx={{ height: 20, fontSize: 11, bgcolor: colors.bg, color: colors.fg }} />
        <Box sx={{ width: 28, display: 'flex', justifyContent: 'center' }}>
          {detail && (
            <IconButton size="small" aria-label={t('bulkPower.showDetail')} onClick={() => setOpen(o => !o)}>
              <i className={open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} style={{ fontSize: 16 }} />
            </IconButton>
          )}
        </Box>
      </Stack>
      {detail && (
        <Collapse in={open}>
          <Typography variant="caption" color={row.error ? 'error' : 'warning.main'} sx={{ display: 'block', px: 1, pb: 1, pl: 4 }}>{detail}</Typography>
        </Collapse>
      )}
    </Box>
  )
}

export default function BulkPowerDialog({ action, guests, skipped, onClose }: {
  action: BulkPowerAction
  /** The guests the action applies to (start: the stopped ones, otherwise the running ones). */
  guests: BulkPowerTarget[]
  /** Selected guests left out because the action does not apply to them. */
  skipped: number
  onClose: () => void
}) {
  const t = useTranslations()
  const toast = useToast()
  const [perNode, setPerNode] = useState(readPerNodePreference)
  const [phase, setPhase] = useState<'confirm' | 'running' | 'done'>('confirm')
  const [rows, setRows] = useState<Row[]>(() => guests.map((g, index) => ({ vmid: String(g.vmid), index, status: 'queued' })))
  const [page, setPage] = useState(1)
  const stopRef = useRef(false)
  const [stopping, setStopping] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true

    return () => { mountedRef.current = false }
  }, [])

  // Leaving the page drops the guests not sent yet: warn while the batch runs.
  useEffect(() => {
    if (phase !== 'running') return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }

    globalThis.addEventListener('beforeunload', warn)

    return () => globalThis.removeEventListener('beforeunload', warn)
  }, [phase])

  const hosts = useMemo(() => new Set(guests.map(g => `${g.connId}\u0000${g.node}`)).size, [guests])
  const counts = useMemo(() => countBulkJobs(rows), [rows])
  const ordered = useMemo(() => orderBulkJobs(rows), [rows])
  const pages = Math.max(1, Math.ceil(ordered.length / PAGE_SIZE))
  const look = POWER_ACTION_LOOK[action]
  const description = t(`bulkPower.running.${action}`)

  const start = () => {
    writePerNodePreference(perNode)
    setPhase('running')
    void runBulkGuestPower(guests, action, {
      perNode,
      shouldContinue: () => !stopRef.current,
      onUpdate: (index, result) => setRows(prev => prev.map(r => (r.index === index ? { ...r, status: result.status, error: result.error, warning: result.warning } : r))),
    }).then(outcome => {
      setPhase('done')
      setTimeout(() => { fetch('/api/v1/inventory/poll', { method: 'POST' }).catch(() => {}) }, 1500)
      // Closed meanwhile: the verdict still reaches the operator.
      if (!mountedRef.current) toast[bulkPowerSeverity(outcome)](bulkPowerMessage(outcome, description, t))
    })
  }

  const visible = ordered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth data-testid="bulk-power-dialog">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{ width: 40, height: 40, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: `${look.color}.main`, color: 'common.white' }}>
          <i className={look.icon} style={{ fontSize: 22 }} />
        </Box>
        {t(`bulkPower.title.${action}`, { count: guests.length })}
      </DialogTitle>
      <DialogContent>
        {phase === 'confirm' ? (
          <Stack spacing={2}>
            <Typography variant="body2">{t('bulkPower.scope', { count: guests.length, hosts })}</Typography>
            {skipped > 0 && (
              <Typography variant="body2" color="text.secondary">{t(`bulkPower.skipped.${action === 'start' ? 'start' : 'other'}`, { count: skipped })}</Typography>
            )}
            {action === 'stop' && <Typography variant="body2" color="error">{t('bulkPower.stopWarning')}</Typography>}
            <Box sx={{ px: 0.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minHeight: 20 }}>
                <Typography variant="caption" color="text.secondary">
                  {t('bulkPower.perNode')}: <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>{perNode}</Box>
                </Typography>
                <Tooltip title={t('bulkPower.perNodeHelp')}>
                  <Box component="i" className="ri-information-line" aria-label={t('bulkPower.perNodeHelp')} sx={{ fontSize: 14, color: 'text.secondary', cursor: 'help' }} />
                </Tooltip>
              </Box>
              <Slider
                size="small"
                value={perNode}
                min={BULK_POWER_PER_NODE_MIN}
                max={BULK_POWER_PER_NODE_MAX}
                step={1}
                marks
                valueLabelDisplay="auto"
                onChange={(_e, v) => setPerNode(v as number)}
                slotProps={{ input: { 'aria-label': t('bulkPower.perNode') } }}
              />
            </Box>
          </Stack>
        ) : (
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap data-testid="bulk-power-counts">
              {(['completed', 'failed', 'active', 'queued', 'cancelled'] as const).filter(k => counts[k] > 0).map(k => (
                <Chip key={k} size="small" variant="outlined" label={`${t(`bulkPower.count.${k}`)}: ${counts[k]}`} sx={{ height: 22, fontSize: 12 }} />
              ))}
            </Stack>
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, '& > :last-child': { borderBottom: 'none' } }}>
              {visible.map(row => <GuestLine key={row.index} action={action} guest={guests[row.index]} row={row} />)}
            </Box>
            {pages > 1 && <Pagination size="small" count={pages} page={page} onChange={(_e, p) => setPage(p)} sx={{ alignSelf: 'center' }} />}
            {phase === 'running' && <Typography variant="caption" color="text.secondary">{t('bulkPower.closeKeepsRunning')}</Typography>}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {phase === 'confirm' && (
          <>
            <Button color="inherit" onClick={onClose}>{t('common.cancel')}</Button>
            <Button variant="contained" color={look.color} onClick={start} data-testid="bulk-power-confirm">{t('common.confirm')}</Button>
          </>
        )}
        {phase === 'running' && (
          <Button color="inherit" disabled={stopping || counts.queued === 0} onClick={() => { stopRef.current = true; setStopping(true) }} data-testid="bulk-power-stop">
            {t('bulkPower.stopQueued')}
          </Button>
        )}
        {phase !== 'confirm' && <Button variant="contained" onClick={onClose} sx={{ ml: 'auto' }}>{t('common.close')}</Button>}
      </DialogActions>
    </Dialog>
  )
}
