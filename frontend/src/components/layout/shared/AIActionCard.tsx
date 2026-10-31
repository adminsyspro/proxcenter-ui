'use client'

import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react'

import Link from 'next/link'

import {
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography
} from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'

import { GuestGlyph, NodeGlyph } from '@/components/automation/drs/glyphs'
import { actionTier, type ActionCard, type ActionKind } from '@/lib/ai/actions/types'

import type { ActionRun } from './useActionExecution'

type Translate = (key: string, values?: Record<string, string>) => string

type Check = ActionCard['preflight']['checks'][number]

const TASK_CENTER_HREF = '/operations/task-center'

export const KIND_ICONS: Record<ActionKind, string> = {
  snapshot: 'ri-camera-line',
  start: 'ri-play-line',
  shutdown: 'ri-shut-down-line',
  reboot: 'ri-restart-line',
  migrate: 'ri-arrow-left-right-line',
  drs_apply: 'ri-scales-3-line',
  backup_add: 'ri-save-3-line',
  maintenance: 'ri-tools-line'
}

const TITLE_KEYS: Record<Exclude<ActionKind, 'maintenance'>, string> = {
  snapshot: 'ai.actions.title.snapshot',
  start: 'ai.actions.title.start',
  shutdown: 'ai.actions.title.shutdown',
  reboot: 'ai.actions.title.reboot',
  migrate: 'ai.actions.title.migrate',
  drs_apply: 'ai.actions.title.drsApply',
  backup_add: 'ai.actions.title.backupAdd'
}

const isExit = (card: ActionCard) => card.params.mode === 'exit'

/** "Live migrate to pve2", "Snapshot ai-20261031-1405": the action and its parameters. */
export function actionTitle(card: ActionCard, t: Translate): string {
  if (card.kind === 'maintenance') return t(isExit(card) ? 'ai.actions.title.maintenanceExit' : 'ai.actions.title.maintenanceEnter')

  // PVE migrates a container with a restart: "Live" would promise otherwise.
  if (card.kind === 'migrate' && card.target.guestKind === 'lxc') return t('ai.actions.title.migrateLxc', { target: String(card.params.target ?? '') })
  if (card.kind === 'migrate') return t(TITLE_KEYS.migrate, { target: String(card.params.target ?? '') })
  if (card.kind === 'snapshot') return t(TITLE_KEYS.snapshot, { name: String(card.params.name ?? '') })
  if (card.kind === 'backup_add') return t(TITLE_KEYS.backup_add, { job: String(card.params.jobId ?? '') })

  return t(TITLE_KEYS[card.kind])
}

const effectKey = (card: ActionCard) =>
  card.kind === 'maintenance'
    ? `ai.actions.effects.${isExit(card) ? 'maintenanceExit' : 'maintenanceEnter'}`
    : `ai.actions.effects.${card.kind}`

// Either says so and the modal opens: the decoder derives the tier with
// `actionTier`, this keeps the second click even for a card that skipped it
// (a container migration included).
export const isDisruptive = (card: ActionCard) => card.tier === 'disruptive' || actionTier(card.kind, card.target) === 'disruptive'

// The state the guest or host had when the card was built, which its checks
// passed: a start is proposed for a stopped guest, a reboot for a running one.
const guestStatusOf = (card: ActionCard): string | undefined => {
  if (card.kind === 'start') return 'stopped'
  if (card.kind === 'shutdown' || card.kind === 'reboot' || card.kind === 'migrate') return 'running'

  return undefined
}

const DONE_KEYS: Record<'done' | 'already-executed' | 'warnings', string> = {
  done: 'ai.actions.done',
  'already-executed': 'ai.actions.alreadyRun',
  warnings: 'ai.actions.doneWithWarnings'
}

const SITUATION_CHANGED = new Set(['expired', 'target-changed', 'preflight-failed', 'out-of-scope'])

export function failureText(run: Extract<ActionRun, { phase: 'failed' }>, t: Translate): string {
  if (run.code === 'cap-reached') return t('ai.actions.errors.capReached')
  if (run.code === 'action-disabled') return t('ai.actions.errors.actionDisabled')
  if (SITUATION_CHANGED.has(run.code)) return t('ai.actions.errors.situationChanged')
  if (run.code === 'network') return t('ai.actions.errors.network')
  if (run.code === 'internal-error') return t('ai.actions.errors.generic')
  if (run.code === 'task-failed') return run.message ? t('ai.actions.errors.taskFailed', { reason: run.message }) : t('ai.actions.errors.taskFailedNoReason')

  return run.message || t('ai.actions.errors.generic')
}

const Separator = () => (
  <Box component='span' aria-hidden sx={{ opacity: 0.5 }}>
    ·
  </Box>
)

/** Guest, host and cluster of the card on one line, with the product's glyphs. */
export function ActionTarget({ card }: { card: ActionCard }) {
  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'
  const dotBorder = theme.palette.background.paper
  const { target } = card
  const isGuest = target.vmid !== undefined

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        minWidth: 0,
        fontSize: '0.75rem',
        lineHeight: 1.6,
        color: 'text.secondary',
        whiteSpace: 'nowrap'
      }}
    >
      {isGuest ? (
        <>
          <GuestGlyph type={target.guestKind} status={guestStatusOf(card)} dotBorder={dotBorder} />
          <Box component='span' sx={{ color: 'text.primary', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {target.name}
          </Box>
          <span>{`#${target.vmid}`}</span>
          <Separator />
          <NodeGlyph status='online' dark={dark} dotBorder={dotBorder} />
          <span>{target.node}</span>
        </>
      ) : (
        <>
          <NodeGlyph status={card.kind === 'maintenance' && isExit(card) ? 'maintenance' : 'online'} dark={dark} dotBorder={dotBorder} />
          <Box component='span' sx={{ color: 'text.primary', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {target.name}
          </Box>
        </>
      )}
      <Separator />
      <Box component='i' className='ri-server-line' aria-hidden sx={{ fontSize: 12, opacity: 0.8 }} />
      <Box component='span' sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {target.cluster}
      </Box>
    </Box>
  )
}

const KindIcon = ({ card }: { card: ActionCard }) => {
  const disruptive = isDisruptive(card)

  return (
    <Box
      aria-hidden
      sx={theme => {
        const color = disruptive ? theme.palette.warning.main : theme.palette.primary.main

        return {
          width: 32,
          height: 32,
          flexShrink: 0,
          borderRadius: 1.5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color,
          bgcolor: alpha(color, theme.palette.mode === 'dark' ? 0.2 : 0.1)
        }
      }}
    >
      <i className={KIND_ICONS[card.kind]} style={{ fontSize: 17 }} />
    </Box>
  )
}

const LEVEL_COLORS: Record<Check['level'], string> = { ok: 'success.main', warn: 'warning.main', block: 'error.main' }

const Dot = ({ level }: { level: Check['level'] }) => (
  <Box component='span' aria-hidden sx={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, bgcolor: LEVEL_COLORS[level] }} />
)

/** The preflight checks, folded: one dot per level with its count, the texts when opened. */
const Checks = ({ checks, t }: { checks: Check[]; t: Translate }) => {
  const [open, setOpen] = useState(false)
  const counts = (['ok', 'warn', 'block'] as const).map(level => ({ level, n: checks.filter(c => c.level === level).length }))

  return (
    <Box sx={{ mt: 1 }}>
      <ButtonBase
        aria-expanded={open}
        onClick={() => setOpen(prev => !prev)}
        sx={{
          gap: 1.5,
          ml: -1,
          px: 1,
          borderRadius: 1,
          fontSize: '0.75rem',
          lineHeight: 1.6,
          color: 'text.secondary',
          '&:hover, &.Mui-focusVisible': { color: 'text.primary' }
        }}
      >
        <i className={open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} style={{ fontSize: 14 }} aria-hidden />
        <span>{t('ai.actions.checks')}</span>
        {counts
          .filter(c => c.n > 0)
          .map(c => (
            <Box key={c.level} component='span' sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
              <Dot level={c.level} />
              {c.n}
            </Box>
          ))}
      </ButtonBase>
      <Collapse in={open} unmountOnExit>
        <Box component='ul' sx={{ listStyle: 'none', m: 0, p: 0, pt: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {checks.map((c, i) => (
            <Box
              key={`${c.level}-${i}`}
              component='li'
              sx={{ display: 'flex', alignItems: 'baseline', gap: 2, fontSize: '0.75rem', lineHeight: 1.5, color: 'text.secondary' }}
            >
              <Box component='span' sx={{ display: 'inline-flex', alignSelf: 'center' }}>
                <Dot level={c.level} />
              </Box>
              {/* Text from Proxmox and the server: always a text node, never markup. */}
              <span>{c.text}</span>
            </Box>
          ))}
        </Box>
      </Collapse>
    </Box>
  )
}

const StatusLine = ({ icon, color, children }: { icon: string; color: string; children: ReactNode }) => (
  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, mt: 1, fontSize: '0.75rem', lineHeight: 1.5, color }}>
    <Box component='i' className={icon} aria-hidden sx={{ fontSize: 14, lineHeight: '18px', flexShrink: 0 }} />
    <Box component='span' sx={{ minWidth: 0, wordBreak: 'break-word' }}>
      {children}
    </Box>
  </Box>
)

/** The second click of a disruptive action: the target and the effect, in full. */
const ConfirmDialog = ({
  card,
  title,
  open,
  disabled,
  onCancel,
  onConfirm,
  t
}: {
  card: ActionCard
  title: string
  open: boolean
  /** Another action started, or the card expired, while the dialog was open. */
  disabled: boolean
  onCancel: () => void
  onConfirm: () => void
  t: Translate
}) => (
  <Dialog
    open={open}
    onClose={onCancel}
    maxWidth='xs'
    fullWidth
    // Escape closes this dialog only, not the assistant panel under it.
    onKeyDown={(e: KeyboardEvent) => {
      if (e.key === 'Escape') e.stopPropagation()
    }}
  >
    <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      <Box component='i' className={KIND_ICONS[card.kind]} aria-hidden sx={{ fontSize: 20, color: 'warning.main' }} />
      {t('ai.actions.confirmTitle', { action: title })}
    </DialogTitle>
    <DialogContent>
      <Box sx={{ px: 3, py: 2.5, mb: 4, borderRadius: 1.5, border: 1, borderColor: 'divider' }}>
        <ActionTarget card={card} />
      </Box>
      <Typography variant='body2'>{t(effectKey(card))}</Typography>
    </DialogContent>
    <DialogActions>
      <Button onClick={onCancel}>{t('common.cancel')}</Button>
      <Button
        variant='contained'
        color={card.kind === 'shutdown' ? 'error' : 'warning'}
        disableElevation
        disabled={disabled}
        onClick={onConfirm}
      >
        {t('ai.actions.confirm')}
      </Button>
    </DialogActions>
  </Dialog>
)

/**
 * One action the assistant proposes (roadmap#188), under its answer or as a
 * step of a plan (`embedded`). The card only shows and sends: the server
 * checks the signature, the rights and the situation again at execution.
 */
export default function AIActionCard({
  card,
  run,
  busy,
  waitsFor,
  previousUnknown,
  embedded = false,
  onExecute,
  t
}: {
  card: ActionCard
  run?: ActionRun
  /** Another action of the widget is running. */
  busy: boolean
  /** Plan step this one waits for, while it has not succeeded here. */
  waitsFor?: number
  /** Plan step before this one whose task outcome is unknown (its tracking stopped). */
  previousUnknown?: number
  embedded?: boolean
  onExecute: (card: ActionCard, confirmed: boolean) => void
  t: Translate
}) {
  const [expired, setExpired] = useState(() => Date.now() >= card.expiresAt)
  const [confirming, setConfirming] = useState(false)

  // A card is signed for 15 minutes (a plan step for 2 hours): it turns
  // expired on screen when the server would start refusing it. A local
  // timer, no request.
  useEffect(() => {
    if (expired) return undefined
    const timer = setTimeout(() => setExpired(true), Math.max(0, card.expiresAt - Date.now()))

    return () => clearTimeout(timer)
  }, [expired, card.expiresAt])

  const title = actionTitle(card, t)
  const disruptive = isDisruptive(card)
  const firstBlock = card.preflight.checks.find(c => c.level === 'block')
  const running = run?.phase === 'sending' || run?.phase === 'tracking'
  const over = run?.phase === 'done' || run?.phase === 'untracked' || (run?.phase === 'failed' && !run.retryable)
  const retry = run?.phase === 'failed' && run.retryable
  const disabled = running || Boolean(firstBlock) || expired || busy || waitsFor !== undefined
  const progress = run?.phase === 'tracking' && run.progress !== undefined && run.progress > 0 && run.progress < 100 ? run.progress : null

  const execute = () => {
    if (disabled) return
    if (disruptive) setConfirming(true)
    else onExecute(card, false)
  }

  const confirm = () => {
    // The engine would drop it silently: the button is disabled, and checked again.
    if (disabled) return
    setConfirming(false)
    onExecute(card, true)
  }

  // One line under the target: the outcome first, then why it cannot run.
  let status: ReactNode = null

  if (run?.phase === 'done') {
    status = (
      <StatusLine icon='ri-checkbox-circle-line' color='success.main'>
        {t(DONE_KEYS[run.code ?? 'done'])}
      </StatusLine>
    )
  } else if (run?.phase === 'untracked') {
    status = (
      <StatusLine icon='ri-time-line' color='text.secondary'>
        {t('ai.actions.untracked')}{' '}
        <Box component={Link} href={TASK_CENTER_HREF} sx={{ color: 'primary.main', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
          {t('ai.actions.taskCenter')}
        </Box>
      </StatusLine>
    )
  } else if (run?.phase === 'failed' && !(retry && expired)) {
    status = (
      <StatusLine icon='ri-error-warning-line' color='error.main'>
        {failureText(run, t)}
      </StatusLine>
    )
  } else if (!running && expired) {
    status = (
      <StatusLine icon='ri-time-line' color='text.secondary'>
        {t('ai.actions.expired')}
      </StatusLine>
    )
  } else if (!running && firstBlock) {
    status = (
      <StatusLine icon='ri-forbid-line' color='error.main'>
        {firstBlock.text}
      </StatusLine>
    )
  } else if (!running && waitsFor !== undefined) {
    status = (
      <StatusLine icon='ri-lock-line' color='text.secondary'>
        {t('ai.actions.waitsFor', { step: String(waitsFor) })}
      </StatusLine>
    )
  } else if (!running && previousUnknown !== undefined) {
    status = (
      <StatusLine icon='ri-error-warning-line' color='warning.main'>
        {t('ai.actions.previousUnknown', { step: String(previousUnknown) })}{' '}
        <Box component={Link} href={TASK_CENTER_HREF} sx={{ color: 'primary.main', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
          {t('ai.actions.taskCenter')}
        </Box>
      </StatusLine>
    )
  }

  return (
    <Box
      role='group'
      aria-label={title}
      sx={
        embedded
          ? { display: 'flex', alignItems: 'flex-start', gap: 3, minWidth: 0 }
          : { display: 'flex', alignItems: 'flex-start', gap: 3, mt: 3, px: 3, py: 2.5, borderRadius: 1.5, border: 1, borderColor: 'divider' }
      }
    >
      <KindIcon card={card} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant='body2' noWrap sx={{ fontWeight: 600, lineHeight: 1.45 }}>
          {title}
        </Typography>
        <ActionTarget card={card} />
        {status}
        {card.preflight.checks.length > 0 && <Checks checks={card.preflight.checks} t={t} />}
      </Box>
      {!over && (
        <Button
          size='small'
          variant={disruptive ? 'outlined' : 'contained'}
          color={disruptive ? 'warning' : 'primary'}
          disableElevation
          disabled={disabled}
          onClick={execute}
          startIcon={running ? <CircularProgress size={12} color='inherit' /> : undefined}
          sx={{ flexShrink: 0, mt: 0.5, whiteSpace: 'nowrap' }}
        >
          <span>{running ? t('ai.actions.running') : t(retry ? 'ai.actions.retry' : 'ai.actions.execute')}</span>
          {progress !== null && (
            <Box component='span' sx={{ ml: 1, opacity: 0.8 }}>
              {`${Math.round(progress)}%`}
            </Box>
          )}
        </Button>
      )}
      {disruptive && (
        <ConfirmDialog
          card={card}
          title={title}
          open={confirming}
          disabled={disabled}
          onCancel={() => setConfirming(false)}
          onConfirm={confirm}
          t={t}
        />
      )}
    </Box>
  )
}
