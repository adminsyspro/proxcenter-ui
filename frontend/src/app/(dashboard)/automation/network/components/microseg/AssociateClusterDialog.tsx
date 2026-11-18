'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { MicrosegApiError, microsegApi } from '@/lib/microseg/api'

import type { NamedConnection } from './clusterModel'
import { ConnectionLine, useConnectionKinds } from './ConnectionGlyph'
import { firewallFindings, type FirewallFindings } from './preflightModel'
import { FLUSH_TOGGLE_SX, FormRow, ONE_LINE_SX, OneLine, writeErrorMessage } from './dialogParts'

/** The refusals of an association that get a message of their own. */
const ASSOCIATE_ERRORS = new Set(['CLUSTER_NOT_EMPTY', 'TOO_MANY_CLUSTERS', 'CLUSTER_UNREADABLE'])

/** A line of the list: one height, so the names of the list and the "All" box line up. */
const LINE_SX = { display: 'flex', alignItems: 'center', minWidth: 0, minHeight: 32, cursor: 'pointer' } as const

type Props = {
  /** The connection the policy is read through (the URL of the call). */
  connectionId: string
  /** The connections that can join, from `candidates`. */
  candidates: NamedConnection[]
  /** How many connections the policy can still take; unknown means no limit here (the backend still refuses). */
  slots?: number
  /** Called once the backend has linked every chosen connection. */
  onDone: () => void
  /** Called when only some were linked: the group changed, the dialog stays open on the refusals. */
  onChanged?: () => void
  onCancel: () => void
}

/**
 * The firewall findings of the candidates the admin has checked, each read once (through its own relay) when its box is
 * first checked and kept for the dialog's life. A candidate whose checks cannot be read has no entry: nothing is shown.
 */
function useCandidateFindings(connectionIds: readonly string[]): Readonly<Record<string, FirewallFindings>> {
  const [found, setFound] = useState<Record<string, FirewallFindings>>({})
  const asked = useRef(new Set<string>())
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  const key = connectionIds.join(',')
  useEffect(() => {
    for (const id of key ? key.split(',') : []) {
      if (asked.current.has(id)) continue
      asked.current.add(id)
      microsegApi(id).getPreflight().then(
        checks => { if (alive.current) setFound(prev => ({ ...prev, [id]: firewallFindings(checks) })) },
        () => undefined,
      )
    }
  }, [key])
  return found
}

/** The small status icon at the end of a candidate's line: red when its cluster firewall is off, orange when its service is stopped. */
function FirewallMark({ findings }: { findings: FirewallFindings | undefined }) {
  const t = useTranslations('microsegPilot.settings.clusters.associate')
  if (!findings) return null
  let mark: { icon: string; color: string; tip: string } | null = null
  if (findings.off) mark = { icon: 'ri-close-circle-fill', color: 'error.main', tip: t('firewallOffHint') }
  else if (findings.serviceNodes.length > 0) mark = { icon: 'ri-alert-fill', color: 'warning.main', tip: t('serviceStoppedHint', { nodes: findings.serviceNodes.join(', ') }) }
  if (!mark) return null
  return (
    <Tooltip title={mark.tip}>
      <Box component='i' role='img' aria-label={mark.tip} className={mark.icon} sx={{ color: mark.color, fontSize: 18, flexShrink: 0, ml: 'auto', pl: 1, boxSizing: 'content-box' }} />
    </Tooltip>
  )
}

/**
 * Associating clusters or standalone nodes with the policy: the candidates as check boxes under an "All" box with
 * three states, and nothing is written on them before the next application (a link stays inactive until then). The
 * backend takes one connection per call: they are sent one after the other, a refusal does not undo the ones already
 * linked and is shown per connection (still holding micro-segmentation data, policy at its maximum, connection that
 * could not be inspected).
 */
export default function AssociateClusterDialog({ connectionId, candidates, slots, onDone, onChanged, onCancel }: Readonly<Props>) {
  const t = useTranslations('microsegPilot.settings.clusters.associate')
  const tAll = useTranslations()
  const tc = useTranslations('common')
  const api = useMemo(() => microsegApi(connectionId), [connectionId])
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  // Clusters and standalone nodes join alike: the glyph tells them apart (the nodes of a cluster are never listed).
  const kinds = useConnectionKinds(candidates.map(c => c.id))

  const room = Math.max(0, Math.min(slots ?? candidates.length, candidates.length))
  // A connection linked meanwhile leaves the candidates: it no longer counts as chosen.
  const chosen = picked.filter(id => candidates.some(c => c.id === id))
  const full = chosen.length >= room
  const findings = useCandidateFindings(chosen)

  const toggle = (id: string) => {
    setErrors([])
    setPicked(chosen.includes(id) ? chosen.filter(p => p !== id) : [...chosen, id])
  }
  const toggleAll = () => {
    setErrors([])
    setPicked(chosen.length > 0 ? [] : candidates.slice(0, room).map(c => c.id))
  }

  const refusal = (name: string, e: unknown) => {
    if (e instanceof MicrosegApiError && ASSOCIATE_ERRORS.has(e.code)) {
      const text = t(`errors.${e.code}`, { name })
      // The message of a cluster that is not empty names it already.
      return e.code === 'CLUSTER_NOT_EMPTY' ? text : `${name}: ${text}`
    }
    return `${name}: ${writeErrorMessage(tAll as (key: string) => string, e)}`
  }

  const submit = async () => {
    if (chosen.length === 0) return
    setBusy(true)
    setErrors([])
    const refused: string[] = []
    const left: string[] = []
    let linked = 0
    for (const c of candidates.filter(x => chosen.includes(x.id))) {
      try {
        await api.associateCluster(c.id)
        linked++
      } catch (e) {
        refused.push(refusal(c.name, e))
        left.push(c.id)
      }
    }
    setBusy(false)
    if (refused.length === 0) {
      onDone()
      return
    }
    setPicked(left)
    setErrors(refused)
    if (linked > 0) onChanged?.()
  }

  return (
    <Dialog open onClose={busy ? undefined : onCancel} maxWidth='sm' fullWidth aria-labelledby='microseg-associate-title'>
      <DialogTitle id='microseg-associate-title' sx={ONE_LINE_SX}>{t('title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          <FormRow label={t('cluster')}>
            <Box role='group' aria-label={t('cluster')} sx={{ maxHeight: 264, overflowY: 'auto', minWidth: 0 }}>
              {candidates.length > 1 ? (
                <Box component='label' sx={LINE_SX}>
                  <Checkbox
                    size='small'
                    checked={chosen.length > 0 && full}
                    indeterminate={chosen.length > 0 && !full}
                    disabled={busy || room === 0}
                    onChange={toggleAll}
                    sx={FLUSH_TOGGLE_SX}
                  />
                  <Typography variant='body2' sx={ONE_LINE_SX}>{tc('all')}</Typography>
                </Box>
              ) : null}
              {candidates.map(c => {
                const on = chosen.includes(c.id)
                return (
                  <Box key={c.id} component='label' sx={LINE_SX}>
                    <Checkbox
                      size='small'
                      checked={on}
                      disabled={busy || (!on && full)}
                      onChange={() => toggle(c.id)}
                      slotProps={{ input: { 'aria-label': c.name } }}
                      sx={FLUSH_TOGGLE_SX}
                    />
                    <Typography component='span' variant='body2' sx={{ minWidth: 0, display: 'flex' }}>
                      <ConnectionLine name={c.name} kind={kinds[c.id]} />
                    </Typography>
                    {on ? <FirewallMark findings={findings[c.id]} /> : null}
                  </Box>
                )
              })}
            </Box>
          </FormRow>
          {room < candidates.length ? <OneLine text={t('room', { count: room })} /> : null}
          <OneLine text={t('nothingWritten')} />
          {/* A refusal says what to do: not a setting row, it wraps on as many lines as it needs, full width. */}
          {errors.length > 0 ? (
            <Alert severity='error'>
              <Stack spacing={0.5}>
                {errors.map(line => <Typography key={line} variant='body2'>{line}</Typography>)}
              </Stack>
            </Alert>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
        <Button onClick={onCancel} disabled={busy}>{tc('cancel')}</Button>
        <Button onClick={() => void submit()} variant='contained' disabled={busy || chosen.length === 0}>{t('confirm')}</Button>
      </DialogActions>
    </Dialog>
  )
}
