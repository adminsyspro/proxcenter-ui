'use client'

import { useState, type ReactNode } from 'react'
import { Box, ButtonBase, Collapse, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { GroupRunError, MicrosegRun } from '@/lib/microseg/types'

import ConnectionGlyph, { useConnectionKind } from './ConnectionGlyph'
import { StepMark } from './PlanSteps'
import { CATCH_UP_ERRORS, looksUnreachable } from './planState'
import { isFirewallOffRunError } from './preflightModel'

export { looksUnreachable }

/** Where the run of one cluster of a group action stands. */
export type ClusterRunStatus = 'running' | 'done' | 'warning' | 'failed' | 'skipped'

/** The status of a cluster's run: a run that did not start is skipped, one that ended with failed steps a warning. */
export function clusterRunStatus(run: MicrosegRun | null, startError?: GroupRunError, fatal = false): ClusterRunStatus {
  if (startError) return 'skipped'
  if (fatal || run?.status === 'failed') return 'failed'
  if (run?.status === 'done') return (run.result?.failed?.length ?? 0) > 0 ? 'warning' : 'done'
  return 'running'
}

/**
 * The i18n key (under microsegPilot.plan) of a cluster that could not be reached. An active cluster catches up by
 * itself at its next pass; a cluster never applied (its link inactive) does not: its link stays inactive until the
 * admin applies again.
 */
export function unreachableKey(catchUpKey: string, inactive: boolean): string {
  return inactive ? 'cluster.neverApplied' : catchUpKey
}

type RunLineInput = { run: MicrosegRun | null; run_id?: string; error?: GroupRunError; fatal?: boolean; abandoned?: boolean }

/**
 * What the line of one cluster says of its run: its status and the i18n key (under microsegPilot.plan) of its text.
 * `inactive`: the cluster was never applied (its link is inactive), so an unreachable one is not promised a catch-up.
 */
export function clusterRunLine(p: RunLineInput, inactive = false): { status: ClusterRunStatus; key: string | null; values?: Record<string, number> } {
  const startError = p.run_id ? undefined : p.error ?? 'internal'
  const status = clusterRunStatus(p.run, startError, !!p.fatal)
  if (startError) return { status, key: startError === 'no_client' ? unreachableKey('cluster.error.no_client', inactive) : `cluster.${startErrorKey(startError)}` }
  // Given up by this page after many failed reads: its status is unknown, not refused by the server.
  if (p.fatal) return { status, key: p.abandoned ? 'cluster.unfollowed' : 'cluster.unreadable' }
  if (status === 'failed' && isFirewallOffRunError(p.run?.error)) return { status, key: 'cluster.firewallOffRun' }
  if (status === 'failed') return { status, key: looksUnreachable(p.run?.error) ? unreachableKey('cluster.applyFailed', inactive) : 'cluster.runFailed' }
  if (status === 'running' || !p.run) return { status, key: null }
  const result = p.run.result
  return { status, key: 'resultSummary', values: { done: result?.done?.length ?? 0, failed: result?.failed?.length ?? 0, notRun: result?.not_run?.length ?? 0 } }
}

/** True when a cluster never applied is left behind by a group action: the admin must apply again once it is reachable. */
export function neverAppliedLeft(runs: readonly (RunLineInput & { connection_id: string })[], inactive: ReadonlySet<string>): boolean {
  return runs.some(r => inactive.has(r.connection_id) && clusterRunLine(r, true).key === 'cluster.neverApplied')
}

/** The severity of the outcome of a group action that has ended. */
export const OUTCOME_SEVERITY = { done: 'success', partial: 'warning', failed: 'error' } as const

/** The i18n key (under microsegPilot.plan.cluster) of why the run of a cluster did not start. */
export function startErrorKey(error: GroupRunError): string {
  return CATCH_UP_ERRORS.has(error) ? `error.${error}` : 'error.internal'
}

/**
 * The name a cluster is shown with: the user's name for it, the tab's connection always, and `other` ("Another cluster")
 * for a cluster the user cannot see (the lookup gives back the bare ID), so no line names a cluster outside their scope.
 * Without `other`, null for such a cluster (the caller leaves it out or says it in general words).
 */
export function shownClusterName(id: string, tabConnection: string, clusterName: ((id: string) => string) | undefined, other: string): string
export function shownClusterName(id: string, tabConnection: string, clusterName?: (id: string) => string): string | null
export function shownClusterName(id: string, tabConnection: string, clusterName?: (id: string) => string, other?: string): string | null {
  const name = clusterName?.(id)
  if (name && (name !== id || id === tabConnection)) return name
  if (id === tabConnection) return id
  return other ?? null
}

function StatusMark({ status }: { status: ClusterRunStatus }) {
  const t = useTranslations('microsegPilot.plan.stepState')
  if (status === 'warning') {
    return <Box component='i' role='img' aria-label={t('failed')} className='ri-error-warning-line' sx={{ width: 18, textAlign: 'center', fontSize: 18, lineHeight: 1, color: 'warning.main', flexShrink: 0 }} />
  }
  return <StepMark state={status === 'skipped' ? 'notRun' : status} />
}

type Props = {
  connectionId: string
  name: string
  status: ClusterRunStatus
  /** What the line says of the cluster's run, on the same line after the chip. */
  text?: string
  /** The full text on hover (the reason of a failure). */
  tip?: string
  /** A short note in the chip ("applies at the next application"). */
  note?: string
  /** Drawn at the end of the line (a progress bar, a step count). */
  extra?: ReactNode
  /** Lines under the cluster's own line (findings about it), each already one line. */
  notes?: ReactNode
  /** The details of the cluster, behind the chevron; without them the line has no chevron. */
  children?: ReactNode
}

/**
 * One cluster of a group action on one line: its status mark, its chip, what its run says, and a chevron at the end that
 * opens its details (the steps of its plan, the outcome of its application).
 */
export default function ClusterRunRow({ connectionId, name, status, text, tip, note, extra, notes, children }: Props) {
  const [open, setOpen] = useState(false)
  const kind = useConnectionKind(connectionId)
  const line = (
    <>
      <StatusMark status={status} />
      {/* The cluster as plain text behind its glyph, its note in full after it: no pill, the line already has its marks. */}
      <Box data-testid='cluster-run-name' title={note ? `${name} · ${note}` : name} sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: '0 1 auto' }}>
        <ConnectionGlyph kind={kind} />
        <Typography variant='body2' fontWeight={600} noWrap sx={{ minWidth: 0, maxWidth: 240, flexShrink: 0 }}>{name}</Typography>
        {note ? <Typography variant='body2' color='text.secondary' noWrap sx={{ minWidth: 0 }}>{note}</Typography> : null}
      </Box>
      {text ? (
        <Tooltip title={tip ?? text}>
          <Typography variant='body2' color={status === 'failed' ? 'error' : 'text.secondary'} noWrap sx={{ minWidth: 0, flex: '0 1 auto' }}>{text}</Typography>
        </Tooltip>
      ) : null}
      <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: '1 1 0', justifyContent: 'flex-end' }}>
        {extra}
        {children ? <i className={open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} /> : null}
      </Box>
    </>
  )
  const rowSx = { display: 'flex', width: '100%', justifyContent: 'flex-start', alignItems: 'center', gap: 1, minHeight: 36, px: 1, textAlign: 'left', minWidth: 0 } as const
  return (
    <Box role='listitem' aria-label={name} sx={{ borderBottom: 1, borderColor: 'divider', minWidth: 0 }}>
      {children ? (
        <ButtonBase onClick={() => setOpen(v => !v)} aria-expanded={open} sx={rowSx}>{line}</ButtonBase>
      ) : (
        <Box sx={rowSx}>{line}</Box>
      )}
      {notes}
      {children ? (
        <Collapse in={open} unmountOnExit>
          <Box sx={{ pl: 4, pr: 1, pb: 1, display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>{children}</Box>
        </Collapse>
      ) : null}
    </Box>
  )
}
