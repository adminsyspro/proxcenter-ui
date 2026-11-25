'use client'

import { Fragment, useMemo, useState } from 'react'

import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useFormatter, useTranslations } from 'next-intl'

import { NodeGlyph } from '@/components/ui/glyphs'
import { formatBytes } from '@/utils/format'
import {
  advancedChanged,
  changesNodes,
  forwarderBlocker,
  invalidFields,
  nodeStateKey,
  nodeStatus,
  settingsOf,
  type LogCollectionCheck,
  type LogCollectionNode,
  type LogCollectionRefusal,
  type LogCollectionSettings,
  type LogCollectionState,
} from '@/lib/logCollection/types'

import { useLogCollection, type LogCollectionResult } from './useLogCollection'

const LABEL_WIDTH = 230
const ROWS_PER_PAGE = 10

const KNOWN_PROBLEMS = new Set(['ssh_unreachable', 'host_key_unconfirmed', 'sudo_missing', 'systemd_unknown', 'receiver_unreachable'])
const KNOWN_REFUSALS = new Set(['SSH_DISABLED', 'NO_POLICY', 'BUSY', 'NOT_LEADER', 'INVALID', 'FEATURE_REQUIRED', 'ORCHESTRATOR_UNAVAILABLE'])
const KNOWN_DRIFTS = new Set(['binary', 'stopped', 'disabled', 'missing'])
const KNOWN_STEPS = new Set(['queued', 'check', 'binary', 'key', 'config', 'start', 'connect', 'stop', 'remove', 'verify', 'done'])

type Translate = ReturnType<typeof useTranslations>

/** One setting on one line: its label, an optional help bubble, its control, and what follows it on the same line. */
function SettingRow({ label, help, children, testId }: { label: string; help?: string; children: React.ReactNode; testId?: string }) {
  return (
    <Box data-testid={testId} sx={{ display: 'flex', alignItems: 'center', gap: 2, minHeight: 40 }}>
      <Box sx={{ width: LABEL_WIDTH, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Typography variant='body2'>{label}</Typography>
        {help && (
          <Tooltip arrow title={help}>
            <Box component='span' sx={{ display: 'inline-flex', cursor: 'default' }}>
              <i className='ri-information-line' style={{ fontSize: 14, opacity: 0.6 }} />
            </Box>
          </Tooltip>
        )}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1, minWidth: 0 }}>{children}</Box>
    </Box>
  )
}

function refusalText(t: Translate, refusal: LogCollectionRefusal): string {
  return t(`settings.logCollection.refusals.${KNOWN_REFUSALS.has(refusal.code) ? refusal.code : 'default'}`)
}

/** The nodes a failed preflight names, each with what keeps it from getting its forwarder. */
function PreflightReport({ checks, t }: { checks: LogCollectionCheck[]; t: Translate }) {
  const failed = checks.filter(c => !c.ok)

  return (
    <Alert severity='error' data-testid='log-collection-preflight'>
      <Typography variant='body2'>{t('settings.logCollection.preflightFailed', { count: failed.length })}</Typography>
      {failed.map(c => (
        <Typography key={c.node} variant='caption' sx={{ display: 'block' }}>
          {c.node} · {(c.problems ?? []).map(p => KNOWN_PROBLEMS.has(p.code)
            ? t(`settings.logCollection.problems.${p.code}`, { detail: p.detail ?? '' })
            : t('settings.logCollection.problems.other', { code: p.code })).join(', ')}
        </Typography>
      ))}
    </Alert>
  )
}

/** The refusal a write answered with, null when it went through. */
function refusalOfResult(result: LogCollectionResult): LogCollectionRefusal | null {
  return 'refusal' in result ? result.refusal : null
}

/** What the confirmation says of a change that reaches the nodes. */
function confirmKind(state: LogCollectionState, form: LogCollectionSettings): 'install' | 'remove' | 'update' {
  if (form.mode === 'api') return 'remove'

  return state.mode === 'api' ? 'install' : 'update'
}

function NodeRow({ node, mode, dark, dotBorder, t, busy, onRetry }: {
  node: LogCollectionNode
  mode: LogCollectionState['mode']
  dark: boolean
  dotBorder: string
  t: Translate
  busy: boolean
  onRetry: (node: string) => void
}) {
  const format = useFormatter()
  const [open, setOpen] = useState(false)
  const stateKey = nodeStateKey(node, mode)
  const details: string[] = []

  if (node.left) details.push(t('settings.logCollection.detail.left'))
  if (node.error) details.push(t('settings.logCollection.detail.error', { error: node.error }))
  if (stateKey === 'missing') details.push(t('settings.logCollection.detail.missing'))
  if (node.state === 'installed' && node.silent) details.push(t('settings.logCollection.detail.silent'))
  if (node.drift) details.push(KNOWN_DRIFTS.has(node.drift) ? t(`settings.logCollection.drift.${node.drift}`) : node.drift)
  if (node.paused) details.push(t('settings.logCollection.detail.paused'))
  if (node.budget_hits_24h) details.push(t('settings.logCollection.detail.budgetHits', { count: node.budget_hits_24h }))

  // A node left installing or removing by a run that did not end (the
  // orchestrator restarted, leadership moved) can be retried once no run is
  // in flight.
  const stuck = (node.state === 'installing' || node.state === 'removing') && !busy
  const retryable = node.state === 'failed' || node.state === 'missing' || stuck || !!node.left
  const cell = { py: 0.75, fontSize: '0.8rem', whiteSpace: 'nowrap' as const }

  return (
    <Fragment>
      <TableRow data-testid={`log-forwarder-${node.node}`}>
        <TableCell sx={cell}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <NodeGlyph status={nodeStatus(node)} dark={dark} dotBorder={dotBorder} testId={`log-forwarder-glyph-${node.node}`} />
            {node.node}
          </Box>
        </TableCell>
        <TableCell sx={cell}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            {t(`settings.logCollection.nodeState.${stateKey}`)}
            {node.variant === 'adm' && (
              <Tooltip arrow title={t('settings.logCollection.variantAdmHelp')}>
                <Chip label={t('settings.logCollection.variantAdm')} size='small' variant='outlined' sx={{ height: 20, fontSize: '0.65rem' }} />
              </Tooltip>
            )}
          </Box>
        </TableCell>
        <TableCell sx={cell}>{node.version || '-'}</TableCell>
        <TableCell sx={cell}>
          {node.last_line_at ? format.relativeTime(new Date(node.last_line_at), new Date()) : t('settings.logCollection.never')}
        </TableCell>
        <TableCell sx={{ ...cell, textAlign: 'right' }}>{node.state === 'installed' ? format.number(Math.round(node.lines_per_min_15m ?? 0)) : '-'}</TableCell>
        <TableCell sx={{ ...cell, textAlign: 'right' }}>{node.state === 'installed' ? formatBytes(node.queue_bytes ?? 0, 0) : '-'}</TableCell>
        <TableCell sx={{ ...cell, textAlign: 'right' }}>{node.state === 'installed' ? format.number(node.dropped ?? 0) : '-'}</TableCell>
        <TableCell sx={{ ...cell, textAlign: 'right', width: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
            {retryable && (
              <Button size='small' variant='outlined' disabled={busy} onClick={() => onRetry(node.node)}>
                {t(node.left ? 'settings.logCollection.removeNode' : node.state === 'missing' ? 'settings.logCollection.install' : 'settings.logCollection.retry')}
              </Button>
            )}
            {details.length > 0 && (
              <IconButton size='small' aria-label={t('settings.logCollection.details')} aria-expanded={open} onClick={() => setOpen(o => !o)}>
                <i className={open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
              </IconButton>
            )}
          </Box>
        </TableCell>
      </TableRow>
      {details.length > 0 && (
        <TableRow>
          <TableCell colSpan={8} sx={{ py: 0, borderBottom: open ? undefined : 'none' }}>
            <Collapse in={open} unmountOnExit>
              <Box sx={{ py: 1 }}>
                {details.map(line => (
                  <Typography key={line} variant='caption' sx={{ display: 'block', color: 'text.secondary', whiteSpace: 'normal' }}>{line}</Typography>
                ))}
              </Box>
            </Collapse>
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  )
}

/**
 * The Logs tab of a Proxmox VE connection: how the firewall logs of the
 * cluster reach the micro-segmentation (the Proxmox API, or a forwarder on
 * each node) and, in forwarder mode, the forwarder of each node. Its settings
 * have their own Apply: they start an installation or a removal on the
 * nodes, which the save of the connection form must not do by itself.
 */
export default function LogCollectionTab({ connectionId, active, pollMs }: { connectionId: string; active: boolean; pollMs?: number }) {
  const t = useTranslations()
  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'
  const dotBorder = theme.palette.background.paper
  const { state, loadError, pending, apply, retry, check } = useLogCollection(connectionId, active, pollMs)
  // What the administrator edited, with the saved settings it was edited
  // from: once those change (a run that ends, another administrator), the
  // edit no longer applies and the form shows what is saved.
  const [draft, setDraft] = useState<{ from: string; form: LogCollectionSettings } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [refusal, setRefusal] = useState<LogCollectionRefusal | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  // Whether the advanced settings are unfolded; until the administrator says, whether one of them was set by hand.
  const [advanced, setAdvanced] = useState<boolean | null>(null)

  const saved = useMemo(() => (state ? settingsOf(state) : null), [state])
  const savedKey = saved ? JSON.stringify(saved) : ''
  const form = draft && draft.from === savedKey ? draft.form : saved

  if (loadError && !state) return <Alert severity='error'>{refusalText(t, loadError)}</Alert>
  if (!state || !form || !saved) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress size={22} />
      </Box>
    )
  }

  const blocker = forwarderBlocker(state)
  const locked = state.busy || pending
  const invalid = invalidFields(form, state.limits)
  const dirty = JSON.stringify(form) !== savedKey
  const forwarder = form.mode === 'forwarder'
  const set = (patch: Partial<LogCollectionSettings>) => {
    setRefusal(null)
    setNotice(null)
    setDraft({ from: savedKey, form: { ...form, ...patch } })
  }
  const number = (value: string) => (value.trim() === '' ? Number.NaN : Number(value))

  const send = async () => {
    setConfirming(false)
    const result = await apply({ ...form, receiver_host: form.receiver_host.trim() })

    const refused = refusalOfResult(result)

    setRefusal(refused)
    // A change that starts a run is applied when the run ends: its progress says so.
    setNotice(refused || (result.ok && result.run) ? null : t('settings.logCollection.applied'))
  }
  const onApply = () => {
    setRefusal(null)
    setNotice(null)
    if (changesNodes(state, form)) setConfirming(true)
    else void send()
  }
  const onRetry = async (node: string) => {
    setNotice(null)
    setRefusal(refusalOfResult(await retry(node)))
  }
  const onCheck = async () => {
    const refused = refusalOfResult(await check())

    setRefusal(refused)
    setNotice(refused ? null : t('settings.logCollection.checked'))
  }

  const kind = confirmKind(state, form)
  const run = state.busy ? state.run : null
  const shown = state.nodes.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE)
  const small = { size: 'small' as const, disabled: locked || !forwarder }
  // A setting that is not valid is never left out of sight: Apply would be disabled with no reason shown.
  const unfolded = (advanced ?? advancedChanged(state)) || (forwarder && invalid.length > 0)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <SettingRow label={t('settings.logCollection.mode')} help={t('settings.logCollection.modeHelp')} testId='log-collection-mode'>
        <ToggleButtonGroup
          exclusive
          size='small'
          value={form.mode}
          onChange={(_e, mode) => mode && set({ mode })}
          aria-label={t('settings.logCollection.mode')}
          // The height of the small inputs of the lines below.
          sx={{ height: 36 }}
        >
          <ToggleButton value='api' disabled={locked} data-testid='log-collection-mode-api' sx={{ textTransform: 'none', px: 2 }}>
            {t('settings.logCollection.modeApi')}
          </ToggleButton>
          <ToggleButton value='forwarder' disabled={locked || (blocker !== null && state.mode !== 'forwarder')} data-testid='log-collection-mode-forwarder' sx={{ textTransform: 'none', px: 2 }}>
            {t('settings.logCollection.modeForwarder')}
          </ToggleButton>
        </ToggleButtonGroup>
        {/* What keeps the forwarder from being chosen, or when to choose it. */}
        <Typography variant='caption' sx={{ color: 'text.secondary' }}>
          {blocker
            ? t(blocker === 'ssh' ? 'settings.logCollection.blockedSsh' : 'settings.logCollection.blockedPolicy')
            : t('settings.logCollection.modeAdvice')}
        </Typography>
      </SettingRow>

      <Box sx={{ pl: theme => `calc(${LABEL_WIDTH}px + ${theme.spacing(2)})` }}>
        <Button
          size='small'
          onClick={() => setAdvanced(!unfolded)}
          aria-expanded={unfolded}
          startIcon={<i className={unfolded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} />}
          sx={{ textTransform: 'none', color: 'text.secondary', ml: -1 }}
        >
          {t('settings.logCollection.advanced')}
        </Button>
      </Box>

      <Collapse in={unfolded} unmountOnExit>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <SettingRow label={t('settings.logCollection.receiver')} help={t('settings.logCollection.receiverHelp')} testId='log-collection-receiver'>
            <TextField
              {...small}
              value={form.receiver_host}
              onChange={e => set({ receiver_host: e.target.value })}
              error={forwarder && invalid.includes('receiver_host')}
              slotProps={{ htmlInput: { 'aria-label': t('settings.logCollection.receiverHost'), spellCheck: false } }}
              sx={{ width: 260 }}
            />
            <TextField
              {...small}
              type='number'
              value={Number.isNaN(form.receiver_port) ? '' : form.receiver_port}
              onChange={e => set({ receiver_port: number(e.target.value) })}
              error={forwarder && invalid.includes('receiver_port')}
              slotProps={{ htmlInput: { 'aria-label': t('settings.logCollection.receiverPort'), min: 1, max: 65535 } }}
              sx={{ width: 110 }}
            />
            {forwarder && invalid.includes('receiver_host') && <Typography variant='caption' color='error'>{t('settings.logCollection.invalid.receiver_host')}</Typography>}
            {forwarder && !invalid.includes('receiver_host') && invalid.includes('receiver_port') && <Typography variant='caption' color='error'>{t('settings.logCollection.invalid.receiver_port')}</Typography>}
          </SettingRow>

          <SettingRow label={t('settings.logCollection.queue')} help={t('settings.logCollection.queueHelp')} testId='log-collection-queue'>
            <TextField
              {...small}
              type='number'
              value={Number.isNaN(form.queue_mb) ? '' : form.queue_mb}
              onChange={e => set({ queue_mb: number(e.target.value) })}
              error={forwarder && invalid.includes('queue_mb')}
              slotProps={{
                htmlInput: { 'aria-label': t('settings.logCollection.queue'), min: state.limits.min_queue_mb, max: state.limits.max_queue_mb },
                input: { endAdornment: <InputAdornment position='end'>{t('settings.logCollection.queueUnit')}</InputAdornment> },
              }}
              sx={{ width: 180 }}
            />
            <Typography variant='caption' color={forwarder && invalid.includes('queue_mb') ? 'error' : 'text.secondary'}>
              {forwarder && invalid.includes('queue_mb')
                ? t('settings.logCollection.invalid.queue_mb', { min: state.limits.min_queue_mb, max: state.limits.max_queue_mb })
                : t('settings.logCollection.range', { min: state.limits.min_queue_mb, max: state.limits.max_queue_mb })}
            </Typography>
          </SettingRow>

          <SettingRow label={t('settings.logCollection.budget')} help={t('settings.logCollection.budgetHelp')} testId='log-collection-budget'>
            <TextField
              {...small}
              type='number'
              value={Number.isNaN(form.budget_lines_per_min) ? '' : form.budget_lines_per_min}
              onChange={e => set({ budget_lines_per_min: number(e.target.value) })}
              error={forwarder && invalid.includes('budget_lines_per_min')}
              slotProps={{
                htmlInput: { 'aria-label': t('settings.logCollection.budget'), min: state.limits.min_budget, max: state.limits.max_budget, step: 1000 },
                input: { endAdornment: <InputAdornment position='end'>{t('settings.logCollection.budgetUnit')}</InputAdornment> },
              }}
              sx={{ width: 180 }}
            />
            <Typography variant='caption' color={forwarder && invalid.includes('budget_lines_per_min') ? 'error' : 'text.secondary'}>
              {forwarder && invalid.includes('budget_lines_per_min')
                ? t('settings.logCollection.invalid.budget_lines_per_min', { min: state.limits.min_budget, max: state.limits.max_budget })
                : t('settings.logCollection.range', { min: state.limits.min_budget, max: state.limits.max_budget })}
            </Typography>
          </SettingRow>
        </Box>
      </Collapse>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pl: theme => `calc(${LABEL_WIDTH}px + ${theme.spacing(2)})`, minHeight: 40 }}>
        <Button variant='contained' size='small' onClick={onApply} disabled={locked || !dirty || invalid.length > 0}>
          {t('settings.logCollection.apply')}
        </Button>
        {state.mode === 'forwarder' && (
          <Button variant='outlined' size='small' onClick={onCheck} disabled={locked}>
            {t('settings.logCollection.check')}
          </Button>
        )}
        {pending && <CircularProgress size={16} />}
        {notice && !refusal && <Typography variant='caption' sx={{ color: 'text.secondary' }}>{notice}</Typography>}
      </Box>

      {refusal?.code === 'PREFLIGHT_FAILED' && refusal.checks && <PreflightReport checks={refusal.checks} t={t} />}
      {refusal && refusal.code !== 'PREFLIGHT_FAILED' && <Alert severity='error'>{refusalText(t, refusal)}</Alert>}

      {run && (
        <Alert severity='info' icon={<CircularProgress size={16} />} data-testid='log-collection-run'>
          <Typography variant='body2'>{t(`settings.logCollection.run.${run.kind === 'uninstall' ? 'uninstall' : 'install'}`)}</Typography>
          {run.nodes.map(n => (
            <Typography key={n.node} variant='caption' sx={{ display: 'block' }}>
              {n.node} · {n.error || (KNOWN_STEPS.has(n.step) ? t(`settings.logCollection.steps.${n.step}`) : n.step)}
            </Typography>
          ))}
        </Alert>
      )}

      <Typography variant='subtitle2' sx={{ mt: 1 }}>{t('settings.logCollection.nodes')}</Typography>
      {state.nodes.length === 0 ? (
        <Typography variant='body2' sx={{ color: 'text.secondary' }}>{t('settings.logCollection.noNodes')}</Typography>
      ) : (
        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflowX: 'auto' }}>
          <Table size='small'>
            <TableHead>
              <TableRow>
                {(['node', 'state', 'version', 'lastLine'] as const).map(c => (
                  <TableCell key={c} sx={{ py: 0.75, fontSize: '0.75rem', whiteSpace: 'nowrap' }}>{t(`settings.logCollection.columns.${c}`)}</TableCell>
                ))}
                {(['rate', 'queue', 'dropped'] as const).map(c => (
                  <TableCell key={c} sx={{ py: 0.75, fontSize: '0.75rem', whiteSpace: 'nowrap', textAlign: 'right' }}>{t(`settings.logCollection.columns.${c}`)}</TableCell>
                ))}
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map(n => (
                <NodeRow key={n.node} node={n} mode={state.mode} dark={dark} dotBorder={dotBorder} t={t} busy={locked} onRetry={onRetry} />
              ))}
            </TableBody>
          </Table>
          {state.nodes.length > ROWS_PER_PAGE && (
            <TablePagination
              component='div'
              count={state.nodes.length}
              page={page}
              onPageChange={(_e, p) => setPage(p)}
              rowsPerPage={ROWS_PER_PAGE}
              rowsPerPageOptions={[ROWS_PER_PAGE]}
            />
          )}
        </Box>
      )}

      <Dialog open={confirming} onClose={() => setConfirming(false)} maxWidth='xs' fullWidth>
        <DialogTitle>{t(`settings.logCollection.confirm.${kind}Title`)}</DialogTitle>
        <DialogContent>
          <Typography variant='body2'>{t(`settings.logCollection.confirm.${kind}Body`)}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(false)}>{t('settings.logCollection.confirm.cancel')}</Button>
          <Button variant='contained' color={kind === 'remove' ? 'warning' : 'primary'} onClick={() => void send()}>
            {t(`settings.logCollection.confirm.${kind}`)}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
