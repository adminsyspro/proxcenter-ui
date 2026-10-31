'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Alert, Box, Button, CircularProgress, Link, Stack, Typography } from '@mui/material'

import { OPENVDDK_DEFAULT_LIBDIR, OPENVDDK_KIT } from '@/lib/migration/warm/vddk-library'

/**
 * Warm runtime of the nodes a batch lands on (roadmap#174).
 *
 * The single VM dialog checks its node before a warm launch (warm-check) and
 * offers "Prepare this node"; the bulk dialog did neither, so a batch aimed at
 * an unprepared node started and every job failed one second later at its
 * planning backstop. Same check here, once per node of the batch, with the
 * same automated preparation. POST /batches checks again before creating.
 */

type WarmSourceVerdict = { sourceVersion: string; minVersion: string; absoluteMin: string; blocked: boolean }

export type BulkWarmNodeVerdict = {
  ok: boolean
  kind: 'nbd' | 'vddk'
  missing: string[]
  error?: string
  /** "Prepare this node" can install OpenVDDK on this node (roadmap#177). */
  setupAvailable: boolean
  /** Directory the node was checked in. */
  libdir?: string
  osUnsupported: boolean
  debianMajor?: number
  source?: WarmSourceVerdict
  /** What the node lacks to convert a Linux / Windows guest at cutover (#1000). */
  guestConversion?: { linux: string[]; windows: string[] }
}

/**
 * Install what a node lacks to convert the guest at cutover: the packages
 * (virt-v2v-in-place, rhsrvany) through the existing install action, the
 * Windows drivers through the background virtio-win download. Shared by the
 * single VM and the bulk dialogs. Throws with the reason on failure.
 */
export async function installGuestConversion(targetConnectionId: string, node: string, missing: string[]): Promise<void> {
  const post = (action: string) => fetch('/api/v1/migrations/preflight', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetConnectionId, targetNode: node, action }),
  }).then(r => r.json().catch(() => ({})))
  if (missing.some(m => !m.startsWith('the VirtIO drivers'))) {
    const d = await post('install')
    if (d?.success === false) throw new Error(String(d.error || d.output || 'install failed').slice(-400))
  }
  if (missing.some(m => m.startsWith('the VirtIO drivers'))) {
    await post('install-virtio-win')
    // The download runs in the background on the node: poll every 2 s, 20 min at most.
    const poll = async (left: number): Promise<void> => {
      if (left <= 0) return
      await new Promise(r => setTimeout(r, 2000))
      const p = await post('check-virtio-win')
      if (p?.done) {
        if (p.error) throw new Error(String(p.error))
        return
      }
      return poll(left - 1)
    }
    await poll(600)
  }
}

type SetupState = { phase: 'confirm' | 'running' | 'error'; error?: string }

const DOCS_URL = 'https://docs.proxcenter.io/automation/migration#warm-migration-node-setup'

async function checkNode(targetConnectionId: string, node: string, sourceConnectionId: string, kind: 'nbd' | 'vddk'): Promise<BulkWarmNodeVerdict> {
  try {
    const r = await fetch('/api/v1/migrations/preflight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetConnectionId, targetNode: node, action: 'warm-check', sourceConnectionId }),
    })
    const d = await r.json()
    return {
      ok: !!d.ok,
      kind: d.kind === 'nbd' ? 'nbd' : 'vddk',
      missing: Array.isArray(d.missing) ? d.missing : [],
      error: d.error,
      setupAvailable: !!d.vddkSetupAvailable,
      libdir: typeof d.libdir === 'string' ? d.libdir : undefined,
      osUnsupported: !!d.osUnsupported,
      debianMajor: d.debianMajor,
      source: d.source,
      guestConversion: d.guestConversion && Array.isArray(d.guestConversion.linux) ? { linux: d.guestConversion.linux, windows: d.guestConversion.windows || [] } : undefined,
    }
  } catch (e) {
    // An answer the dialog cannot read blocks the launch, like the single VM check.
    return { ok: false, kind, missing: [], error: e instanceof Error ? e.message : String(e), setupAvailable: false, osUnsupported: false }
  }
}

export function useBulkWarmReadiness({ sourceConnectionId, targetConnectionId, nodes, kind, conversion }: Readonly<{
  sourceConnectionId: string
  targetConnectionId: string
  /** Distinct nodes the batch lands on; empty when the batch is not a warm one. */
  nodes: string[]
  kind: 'nbd' | 'vddk'
  /**
   * Guest conversion at cutover, when switched on: which guest families land on
   * each node. A node that cannot convert them holds the launch, like the single
   * VM dialog: install what is missing or switch the conversion off.
   */
  conversion?: { enabled: boolean; guestsByNode: Record<string, { linux: boolean; windows: boolean }> }
}>) {
  // Verdicts belong to one source and one target cluster: switching either drops them.
  const scope = `${sourceConnectionId}::${targetConnectionId}`
  const [verdicts, setVerdicts] = useState<{ scope: string; byNode: Record<string, BulkWarmNodeVerdict | 'checking'> }>({ scope: '', byNode: {} })
  const [setup, setSetup] = useState<{ scope: string; byNode: Record<string, SetupState> }>({ scope: '', byNode: {} })
  const [convInstall, setConvInstall] = useState<{ scope: string; byNode: Record<string, { running: boolean; error?: string }> }>({ scope: '', byNode: {} })
  const byNode = useMemo(() => (verdicts.scope === scope ? verdicts.byNode : {}), [verdicts, scope])
  const setupByNode = setup.scope === scope ? setup.byNode : {}

  useEffect(() => {
    const todo = nodes.filter(n => !(n in byNode))
    if (todo.length === 0) return
    setVerdicts(prev => ({
      scope,
      byNode: { ...(prev.scope === scope ? prev.byNode : {}), ...Object.fromEntries(todo.map(n => [n, 'checking' as const])) },
    }))
    for (const node of todo) {
      void checkNode(targetConnectionId, node, sourceConnectionId, kind).then(v => {
        setVerdicts(prev => (prev.scope === scope && prev.byNode[node] === 'checking' ? { scope, byNode: { ...prev.byNode, [node]: v } } : prev))
      })
    }
  }, [nodes, byNode, scope, targetConnectionId, sourceConnectionId, kind])

  const setNodeSetup = useCallback((node: string, state: SetupState | null) => {
    setSetup(prev => {
      const rest = { ...(prev.scope === scope ? prev.byNode : {}) }
      if (state) rest[node] = state
      else delete rest[node]
      return { scope, byNode: rest }
    })
  }, [scope])

  const recheck = useCallback((node: string) => {
    setVerdicts(prev => {
      if (prev.scope !== scope) return prev
      const rest = { ...prev.byNode }
      delete rest[node]
      return { scope, byNode: rest }
    })
  }, [scope])

  const prepare = useCallback(async (node: string) => {
    setNodeSetup(node, { phase: 'running' })
    try {
      const r = await fetch('/api/v1/migrations/warm-node-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetConnectionId, targetNode: node }),
      })
      const d: { ok?: boolean; missing?: string[]; error?: string } = await r.json().catch(() => ({}))
      if (r.ok && d.ok) {
        setNodeSetup(node, null)
        // Drop the verdict so the effect above checks the node again.
        recheck(node)
      } else {
        setNodeSetup(node, { phase: 'error', error: d.error || (d.missing?.length ? d.missing.join(', ') : `HTTP ${r.status}`) })
      }
    } catch (e) {
      setNodeSetup(node, { phase: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  }, [targetConnectionId, setNodeSetup, recheck])

  const installConversion = useCallback(async (node: string, missing: string[]) => {
    const put = (state: { running: boolean; error?: string } | null) => setConvInstall(prev => {
      const rest = { ...(prev.scope === scope ? prev.byNode : {}) }
      if (state) rest[node] = state
      else delete rest[node]
      return { scope, byNode: rest }
    })
    put({ running: true })
    try {
      await installGuestConversion(targetConnectionId, node, missing)
      put(null)
      recheck(node)
    } catch (e) {
      put({ running: false, error: e instanceof Error ? e.message : String(e) })
    }
  }, [scope, targetConnectionId, recheck])

  const conversionMissingOf = (node: string, v: BulkWarmNodeVerdict): string[] => {
    if (!conversion?.enabled) return []
    const gc = v.guestConversion
    const guests = conversion.guestsByNode[node]
    if (!gc || !guests) return []
    return [...new Set([...(guests.linux ? gc.linux : []), ...(guests.windows ? gc.windows : [])])]
  }

  const pending = nodes.filter(n => !(n in byNode) || byNode[n] === 'checking')
  const notReady = nodes.flatMap(n => {
    const v = byNode[n]
    if (!v || v === 'checking') return []
    const conversionMissing = conversionMissingOf(n, v)
    return !v.ok || conversionMissing.length > 0 ? [{ node: n, verdict: v, conversionMissing }] : []
  })
  const convByNode = convInstall.scope === scope ? convInstall.byNode : {}

  return {
    /** True while a node is being checked or is not ready: the launch waits. */
    blocked: pending.length > 0 || notReady.length > 0,
    checking: pending.length > 0,
    notReady,
    setupByNode,
    convByNode,
    installConversion,
    askPrepare: (node: string) => setNodeSetup(node, { phase: 'confirm' }),
    cancelPrepare: (node: string) => setNodeSetup(node, null),
    prepare,
  }
}

export type BulkWarmReadiness = ReturnType<typeof useBulkWarmReadiness>

/** What "Prepare this node" will do: install OpenVDDK, checksum verified. Shared with the single VM dialog. */
export function useWarmSetupConfirmText() {
  const t = useTranslations('inventoryPage.esxiMigration')
  return (libdir: string | undefined) =>
    t('warmSetupConfirmText', {
      version: OPENVDDK_KIT.version,
      size: String(OPENVDDK_KIT.sizeMB),
      installed: String(OPENVDDK_KIT.installedMB),
      libdir: libdir || OPENVDDK_DEFAULT_LIBDIR,
    })
}

/** Why a node is not ready: the source it cannot read, its OS, what it misses, or the probe's error. */
function NodeReason({ verdict }: Readonly<{ verdict: BulkWarmNodeVerdict }>) {
  const t = useTranslations('inventoryPage.esxiMigration')
  let text: string | undefined
  if (verdict.source?.blocked) {
    text = `${t('warmSourceTooOld', { version: verdict.source.sourceVersion, min: verdict.source.absoluteMin })} ${t('warmSourceUseCold')}`
  } else if (verdict.kind === 'vddk' && verdict.osUnsupported) {
    text = t('warmPrepNeedsPve9', { debian: String(verdict.debianMajor ?? ''), pve: String((verdict.debianMajor ?? 13) - 4) })
  } else if (verdict.missing.length > 0) {
    text = t('warmPreflightMissing', { items: verdict.missing.join(', ') })
  } else {
    text = verdict.error
  }
  return (
    <>
      {text && <Typography variant="body2" sx={{ mb: 0.5 }}>{text}</Typography>}
      {verdict.kind === 'nbd' && <Typography variant="body2">{t('warmPreflightNbdHint')}</Typography>}
    </>
  )
}

/** "Prepare this node", its confirmation, its progress and its failure. */
function PrepareControls({ node, setup, readiness, verdict }: Readonly<{ node: string; setup?: SetupState; readiness: BulkWarmReadiness; verdict: BulkWarmNodeVerdict }>) {
  const t = useTranslations('inventoryPage.esxiMigration')
  const confirmText = useWarmSetupConfirmText()
  if (setup?.phase === 'running') {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <CircularProgress size={14} />
        <Typography variant="body2">{t('warmSetupRunning')}</Typography>
      </Box>
    )
  }
  if (setup?.phase === 'confirm') {
    return (
      <>
        <Typography variant="body2" sx={{ mb: 0.75 }}>{confirmText(verdict.libdir)}</Typography>
        <Stack direction="row" spacing={1}>
          <Button size="small" color="warning" variant="contained" startIcon={<i className="ri-download-line" />} onClick={() => { void readiness.prepare(node) }} sx={{ textTransform: 'none', fontSize: 11, whiteSpace: 'nowrap' }}>
            {t('warmSetupConfirm')}
          </Button>
          <Button size="small" color="inherit" onClick={() => readiness.cancelPrepare(node)} sx={{ textTransform: 'none', fontSize: 11 }}>
            {t('warmSetupCancel')}
          </Button>
        </Stack>
      </>
    )
  }
  return (
    <>
      {setup?.phase === 'error' && (
        <Typography variant="body2" color="error.main" sx={{ mb: 0.75 }}>
          {t('warmSetupFailed', { error: setup.error || '' })}
        </Typography>
      )}
      <Button size="small" color="warning" variant="contained" startIcon={<i className="ri-tools-line" />} onClick={() => readiness.askPrepare(node)} sx={{ textTransform: 'none', fontSize: 11, whiteSpace: 'nowrap' }}>
        {t('warmSetupAction')}
      </Button>
    </>
  )
}

/** What the bulk dialog shows for the nodes the check holds back. */
export default function BulkWarmReadinessAlert({ readiness }: Readonly<{ readiness: BulkWarmReadiness }>) {
  const t = useTranslations('inventoryPage.esxiMigration')
  const { checking, notReady, setupByNode } = readiness

  if (notReady.length === 0) {
    return checking ? (
      <Alert severity="info" icon={<CircularProgress size={16} />} sx={{ fontSize: 12 }} data-testid="bulk-warm-checking">
        {t('warmPreflightChecking')}
      </Alert>
    ) : null
  }

  return (
    <Alert severity="warning" sx={{ fontSize: 12, '& .MuiAlert-message': { width: '100%' } }} data-testid="bulk-warm-not-ready">
      <Stack spacing={1.25}>
        {notReady.map(({ node, verdict, conversionMissing }) => (
          <Box key={node} data-testid={`bulk-warm-node-${node}`}>
            <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
              {t('bulkWarmNodeNotReady', { node })}
            </Typography>
            {!verdict.ok && <NodeReason verdict={verdict} />}
            {!verdict.ok && verdict.kind === 'vddk' && verdict.setupAvailable && !verdict.osUnsupported && !verdict.source?.blocked && (
              <PrepareControls node={node} setup={setupByNode[node]} readiness={readiness} verdict={verdict} />
            )}
            {conversionMissing.length > 0 && (
              <Box data-testid={`bulk-warm-conversion-${node}`} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, mt: verdict.ok ? 0 : 1 }}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2"><Box component="span" sx={{ fontWeight: 600 }}>{t('warmPrereqConversion')}</Box> · {t('warmPrereqMissing', { items: conversionMissing.join(', ') })}</Typography>
                  <Typography variant="caption" sx={{ display: 'block', opacity: 0.75 }}>{t('warmPrereqConversionHint')}</Typography>
                  {readiness.convByNode[node]?.error && (
                    <Typography variant="caption" color="error.main" sx={{ display: 'block' }}>
                      {t('convertGuestInstallFailed', { error: readiness.convByNode[node]?.error || '' })}
                    </Typography>
                  )}
                </Box>
                <Button size="small" variant="outlined" color="warning" disabled={!!readiness.convByNode[node]?.running}
                  onClick={() => { void readiness.installConversion(node, conversionMissing) }}
                  startIcon={readiness.convByNode[node]?.running ? <CircularProgress size={12} color="inherit" /> : undefined}
                  sx={{ textTransform: 'none', fontSize: 11, whiteSpace: 'nowrap', py: 0.25, flexShrink: 0 }}>
                  {readiness.convByNode[node]?.running ? t('convertGuestInstalling') : t('warmPrereqInstall')}
                </Button>
              </Box>
            )}
          </Box>
        ))}
        {notReady.some(n => n.verdict.kind === 'vddk' && !n.verdict.ok) && (
          <Typography variant="caption" sx={{ opacity: 0.8, display: 'block' }}>
            {t.rich('warmPreflightDocsHint', {
              link: (chunks) => (
                <Link href={DOCS_URL} target="_blank" rel="noopener noreferrer" sx={{ fontWeight: 600 }}>{chunks}</Link>
              ),
            })}
          </Typography>
        )}
      </Stack>
    </Alert>
  )
}
