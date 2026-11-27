'use client'
import { useCallback, useEffect, useRef, useState, Fragment, type ReactNode } from 'react'
import {
  Drawer, Tabs, Tab, Box, Typography, Alert, Chip, IconButton, Collapse, useTheme,
  Button, LinearProgress,
} from '@mui/material'
import { useTranslations } from 'next-intl'
import { panelMessage } from '@/lib/k8s/panelState'
import { phaseColor, kindColor } from '@/lib/k8s/k8sTopologyColors'
import { podListPreview } from '@/lib/k8s/nodeDrain'
import { postNodeOp, NODE_OP_ICONS, type DrainRowState } from '@/lib/k8s/nodeOpsClient'
import type { KindDef } from '@/lib/k8s/resourceKinds'
import type { ResourceListItem, GetResourceResult, EventsResult, ContainerInfo } from '@/lib/k8s/types'
import { PodLogsPanel } from './PodLogsPanel'
import { KindIcon } from './KindIcon'

const OK = '#4caf50'
const BAD = '#f44336'
const WARN = '#ff9800'

function copy(text: string) {
  try { navigator.clipboard?.writeText(text) } catch { /* clipboard unavailable */ }
}

/** Collapsible section with a chevron + optional icon + count, radar-style. */
function DrawerSection({
  title, icon, count, defaultOpen = true, children,
}: { title: string; icon?: string; count?: number; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Box sx={{ borderTop: 1, borderColor: 'divider', pt: 1, mt: 1 }}>
      <Box
        onClick={() => setOpen((o) => !o)}
        sx={{ display: 'flex', alignItems: 'center', gap: 0.75, cursor: 'pointer', userSelect: 'none' }}
      >
        <i className={open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} style={{ fontSize: 16, opacity: 0.5 }} />
        {icon && <i className={icon} style={{ fontSize: 14, opacity: 0.6 }} />}
        <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, opacity: 0.8 }}>
          {title}
        </Typography>
        {typeof count === 'number' && (
          <Typography variant="caption" sx={{ opacity: 0.5 }}>({count})</Typography>
        )}
      </Box>
      <Collapse in={open}><Box sx={{ pt: 0.75, pl: 2.75 }}>{children}</Box></Collapse>
    </Box>
  )
}

function KVGrid({ entries }: { entries: Array<[string, string]> }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 2, rowGap: 0.3 }}>
      {entries.map(([k, v]) => (
        <Fragment key={k}>
          <Box sx={{ fontSize: '0.8rem', opacity: 0.65 }}>{k}</Box>
          <Box sx={{ fontSize: '0.8rem', wordBreak: 'break-word' }}>{v}</Box>
        </Fragment>
      ))}
    </Box>
  )
}

function ContainerCard({ c }: { c: ContainerInfo }) {
  return (
    <Box
      sx={{
        border: 1,
        borderColor: c.ready ? 'divider' : BAD,
        borderRadius: 1,
        p: 1,
        mb: 1,
        bgcolor: c.ready ? 'transparent' : 'rgba(244,67,54,0.06)',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5, flexWrap: 'wrap' }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{c.name}</Typography>
        <Chip
          size="small"
          label={c.ready ? 'Ready' : 'Not ready'}
          sx={{ height: 18, fontSize: '0.62rem', bgcolor: `${c.ready ? OK : BAD}26`, color: c.ready ? OK : BAD }}
        />
        {c.state && (
          <Chip size="small" label={c.state} sx={{ height: 18, fontSize: '0.62rem' }} />
        )}
      </Box>
      <Box sx={{ fontSize: '0.75rem', opacity: 0.85, wordBreak: 'break-all' }}>Image: {c.image}</Box>
      <Box sx={{ fontSize: '0.75rem', color: c.restartCount > 0 ? BAD : 'inherit', opacity: c.restartCount > 0 ? 1 : 0.85 }}>
        Restarts: {c.restartCount}
      </Box>
    </Box>
  )
}

/** Compact background-drain status for the node drawer (mirrors the table state). */
function NodeDrainStatus({ state }: { state: DrainRowState }) {
  const t = useTranslations('kubernetes.node.ops')
  const r = state.result

  if (state.phase === 'draining') {
    return (
      <Box sx={{ mt: 1 }}>
        <LinearProgress sx={{ mb: 0.75 }} />
        <Typography variant="body2">{t('draining', { count: r ? r.remaining.length : 0 })}</Typography>
        {r && r.blockedByPdb.length > 0 && (
          <Typography variant="body2" sx={{ color: WARN, mt: 0.5, wordBreak: 'break-word' }}>
            {t('blockedByPdb', { pods: podListPreview(r.blockedByPdb) })}
          </Typography>
        )}
        {r && r.evictionFailures.length > 0 && (
          <Typography variant="body2" sx={{ color: BAD, mt: 0.5, wordBreak: 'break-word' }}>
            {t('evictionFailed', { pods: podListPreview(r.evictionFailures) })}
            {r.evictionFailureReason ? ` (${r.evictionFailureReason})` : ''}
          </Typography>
        )}
      </Box>
    )
  }
  if (state.phase === 'done') return <Alert severity="success" sx={{ mt: 1 }}>{t('drained')}</Alert>
  if (state.phase === 'error') return <Alert severity="error" sx={{ mt: 1 }}>{state.error}</Alert>

  // stopped: could not fully drain — surface why.
  const refused = r ? [...r.refusedEmptyDir, ...r.refusedUnmanaged] : []
  return (
    <Box sx={{ mt: 1 }}>
      {r && r.blockedByPdb.length > 0 && (
        <Alert severity="warning" sx={{ mb: 1 }}>{t('blockedByPdb', { pods: podListPreview(r.blockedByPdb) })}</Alert>
      )}
      {r && r.evictionFailures.length > 0 && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {t('evictionFailed', { pods: podListPreview(r.evictionFailures) })}
          {r.evictionFailureReason && (
            <Typography variant="caption" sx={{ display: 'block', mt: 0.5, wordBreak: 'break-word' }}>
              {r.evictionFailureReason}
            </Typography>
          )}
        </Alert>
      )}
      {refused.length > 0 && (
        <Alert severity="warning" sx={{ mb: 1 }}>
          {t('refusedHint')}
          <Typography variant="caption" sx={{ display: 'block', mt: 0.5, wordBreak: 'break-word' }}>
            {podListPreview(refused)}
          </Typography>
        </Alert>
      )}
      {r && r.remaining.length > 0 && (
        <Typography variant="body2">{t('draining', { count: r.remaining.length })}</Typography>
      )}
    </Box>
  )
}

/**
 * Node day-2 action buttons for the drawer: cordon/uncordon (inline), and drain
 * / enter-maintenance which open the shared confirm dialog (the drain itself
 * runs in the background, progress shown in the Nodes table + below). Rendered
 * only for kind=node and k8s.manage; the API routes enforce the permission.
 */
function NodeOpsPanel({
  clusterId, nodeName, unschedulable, drainState, onUnschedulable, onMutated, onOpenDrainDialog,
}: {
  clusterId: string
  nodeName: string
  unschedulable: boolean
  /** Background drain progress for this node (from the explorer). */
  drainState?: DrainRowState
  onUnschedulable: (next: boolean) => void
  onMutated: () => void
  /** Open the shared drain confirm dialog for this node. */
  onOpenDrainDialog: () => void
}) {
  const t = useTranslations('kubernetes.node.ops')
  const [busy, setBusy] = useState(false)
  const [opError, setOpError] = useState<string | null>(null)
  // False once this panel instance is gone (node switch / drawer close); guards
  // a cordon response from applying to whatever node is shown next.
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  async function setCordon(next: boolean) {
    setBusy(true)
    setOpError(null)
    try {
      const data = await postNodeOp(clusterId, nodeName, 'cordon', { unschedulable: next })
      if (!aliveRef.current) return // node changed while the request was in flight
      onUnschedulable(data?.unschedulable === true)
      onMutated()
    } catch (err) {
      setOpError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const draining = drainState?.phase === 'draining'

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', mt: 1 }}>
        <Button
          size="small" variant="outlined" disabled={busy} onClick={() => setCordon(!unschedulable)}
          startIcon={<i className={unschedulable ? NODE_OP_ICONS.uncordon : NODE_OP_ICONS.cordon} />}
        >
          {unschedulable ? t('uncordon') : t('cordon')}
        </Button>
        <Button
          size="small" variant="outlined" color="warning" disabled={busy || draining} onClick={() => onOpenDrainDialog()}
          startIcon={<i className={NODE_OP_ICONS.drain} />}
        >
          {t('drain')}
        </Button>
      </Box>
      {opError && <Alert severity="error" sx={{ mt: 1 }}>{opError}</Alert>}
      {drainState && <NodeDrainStatus state={drainState} />}
    </>
  )
}

export function ResourceDrawer({
  clusterId,
  kind,
  item,
  canManage,
  drainState,
  onNodeMutated,
  onOpenDrainDialog,
  onClose,
  onYamlOpenChange,
}: {
  clusterId: string
  kind: KindDef
  item: ResourceListItem | null
  /** hasPermission('k8s.manage') from the explorer; cosmetic gate (routes re-check). */
  canManage?: boolean
  /** Background drain progress for the selected node (from the explorer). */
  drainState?: DrainRowState
  onNodeMutated?: () => void
  /** Open the shared drain confirm dialog for the selected node. */
  onOpenDrainDialog?: () => void
  onClose: () => void
  onYamlOpenChange?: (open: boolean) => void
}) {
  const t = useTranslations('kubernetes.explorer')
  const tOps = useTranslations('kubernetes.node.ops')
  const theme = useTheme()
  const [tab, setTab] = useState(0)
  const [detail, setDetail] = useState<GetResourceResult | null>(null)
  const [events, setEvents] = useState<EventsResult | null>(null)
  // Bumped after a node op so the detail refetches without resetting the tab.
  const [opTick, setOpTick] = useState(0)
  // Scheduling state (cordoned or not). Seeded from the list row, then kept
  // current from cordon/drain responses; the list row itself only updates on
  // the next poll.
  const [unsched, setUnsched] = useState(false)

  useEffect(() => {
    setTab(0)
    setUnsched(item?.summary?.['unschedulable'] === 'true')
  }, [item])

  // A background drain cordons the node first; keep the drawer's scheduling chip
  // and buttons in sync while it runs (the click-time `item` snapshot is stale).
  useEffect(() => {
    if (drainState?.result?.cordoned) setUnsched(true)
  }, [drainState])

  const handleNodeMutated = useCallback(() => {
    setOpTick((n) => n + 1)
    onNodeMutated?.()
  }, [onNodeMutated])

  useEffect(() => {
    if (!item) return
    setDetail(null)
    setEvents(null)

    const qs = new URLSearchParams({ kind: kind.apiKind, name: item.name })
    if (item.namespace) qs.set('namespace', item.namespace)
    fetch(`/api/v1/k8s/clusters/${clusterId}/resources?${qs.toString()}`)
      .then(async res => {
        if (!res.ok) {
          const code = res.status === 403 ? 'forbidden' : res.status === 404 ? 'not_found' : 'unreachable'
          setDetail({ detail: null, errorCode: code })
        } else {
          setDetail(await res.json())
        }
      })
      .catch(() => setDetail({ detail: null, errorCode: 'unreachable' }))

    const eq = new URLSearchParams({ uid: item.uid })
    if (item.namespace) eq.set('namespace', item.namespace)
    fetch(`/api/v1/k8s/clusters/${clusterId}/events?${eq.toString()}`)
      .then(async res => {
        if (!res.ok) {
          const code = res.status === 403 ? 'forbidden' : res.status === 404 ? 'not_found' : 'unreachable'
          setEvents({ items: [], errorCode: code })
        } else {
          setEvents(await res.json())
        }
      })
      .catch(() => setEvents({ items: [], errorCode: 'unreachable' }))
  }, [item, kind.apiKind, clusterId, opTick])

  useEffect(() => {
    onYamlOpenChange?.(!!item && tab === 1)
  }, [item, tab, onYamlOpenChange])

  const isPod = kind.apiKind === 'pod'
  const detMsg = detail
    ? panelMessage({ status: detail.errorCode ? 'error' : 'ok', errorCode: detail.errorCode })
    : null

  const d = detail?.detail
  // Merge: node detail carries an empty summary, so the list-row values (ready,
  // roles, unschedulable) must survive; fresher detail values (pod phase) win.
  const summary = { ...(item?.summary ?? {}), ...(d?.summary ?? {}) }
  const containers = d?.containers ?? []
  const accent = kindColor(kind.apiKind)

  // Node day-2 ops context (cordon/drain). Control-plane / last-node warnings
  // are computed by the explorer (it owns the node list) and shown in the shared
  // drain dialog it renders.
  const isNode = kind.apiKind === 'node'
  const showNodeOps = isNode && !!canManage && !!item && !!onOpenDrainDialog

  // Headline status chip
  let statusChip: { label: string; color: string } | null = null
  if (kind.apiKind === 'pod' && summary.phase) statusChip = { label: summary.phase, color: phaseColor(summary.phase) }
  else if (kind.apiKind === 'node') statusChip = summary.ready === 'True' ? { label: 'Ready', color: OK } : { label: 'Not Ready', color: BAD }
  else if (summary.ready) statusChip = { label: summary.ready, color: theme.palette.text.secondary }
  else if (summary.phase) statusChip = { label: summary.phase, color: phaseColor(summary.phase) }

  // Issues detected (pods): containers with an unready status
  const issues = isPod ? containers.filter((c) => !c.ready).map((c) => `${c.name}: ${c.state || 'not ready'}`) : []

  return (
    <Drawer
      anchor="right"
      open={!!item}
      onClose={onClose}
      PaperProps={{ sx: { width: 580, p: 2, height: 'calc(100% - var(--taskbar-height, 0px))' } }}
    >
      {item && (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
          {/* Header: kind + status badges, close */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
            <Chip
              size="small"
              icon={<KindIcon icon={kind.icon} iconImg={kind.iconImg} size={13} sx={{ color: accent }} />}
              label={kind.apiKind}
              sx={{
                bgcolor: `${accent}22`, color: accent, fontWeight: 700, fontSize: '0.65rem',
                height: 22, textTransform: 'uppercase', letterSpacing: 0.3,
                '& .MuiChip-icon': { color: accent, ml: 0.75 },
              }}
            />
            {statusChip && (
              <Chip
                size="small"
                label={statusChip.label}
                sx={{ bgcolor: `${statusChip.color}22`, color: statusChip.color, fontWeight: 700, fontSize: '0.65rem', height: 22 }}
              />
            )}
            {showNodeOps && (
              <Chip
                size="small"
                label={unsched ? tOps('scheduling.disabled') : tOps('scheduling.ready')}
                sx={{
                  bgcolor: `${unsched ? WARN : OK}22`, color: unsched ? WARN : OK,
                  fontWeight: 700, fontSize: '0.65rem', height: 22,
                }}
              />
            )}
            <Box sx={{ flex: 1 }} />
            <IconButton size="small" onClick={onClose} aria-label="Close">
              <i className="ri-close-line" style={{ fontSize: 18 }} />
            </IconButton>
          </Box>

          {/* Name + copy */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
            <Typography variant="h6" sx={{ wordBreak: 'break-all', lineHeight: 1.3 }}>{item.name}</Typography>
            <IconButton size="small" onClick={() => copy(item.name)} aria-label="copy">
              <i className="ri-file-copy-line" style={{ fontSize: 14, opacity: 0.55 }} />
            </IconButton>
          </Box>
          {item.namespace && (
            <Typography variant="caption" color="text.secondary">{item.namespace}</Typography>
          )}

          {showNodeOps && (
            <NodeOpsPanel
              key={item.name}
              clusterId={clusterId}
              nodeName={item.name}
              unschedulable={unsched}
              drainState={drainState}
              onUnschedulable={setUnsched}
              onMutated={handleNodeMutated}
              onOpenDrainDialog={onOpenDrainDialog!}
            />
          )}

          <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" sx={{ mt: 1 }}>
            <Tab label={t('tab.summary')} />
            <Tab label={t('tab.yaml')} />
            <Tab label={t('tab.events')} />
            {isPod && <Tab label={t('tab.logs')} />}
          </Tabs>

          {detMsg && (
            <Alert severity={detMsg.tone} sx={{ mt: 1 }}>
              {t(`msg.${detMsg.key}`)}
            </Alert>
          )}

          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              mt: 1,
              display: 'flex',
              flexDirection: 'column',
              overflow: tab === 3 ? 'hidden' : 'auto',
            }}
          >
          {tab === 0 && d && (
            <Box>
              {/* Issues detected */}
              {issues.length > 0 && (
                <Alert severity="error" icon={<i className="ri-error-warning-line" />} sx={{ mb: 1 }}>
                  <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.25 }}>
                    {t('detail.issues')}
                  </Typography>
                  {issues.map((iss) => (
                    <Typography key={iss} variant="caption" sx={{ display: 'block' }}>• {iss}</Typography>
                  ))}
                </Alert>
              )}

              {/* Containers (rich cards) */}
              {containers.length > 0 && (
                <DrawerSection title={t('section.containers')} icon="ri-box-3-line" count={containers.length}>
                  {containers.map((c) => <ContainerCard key={c.name} c={c} />)}
                </DrawerSection>
              )}

              {/* Enrichment sections (structured detail) */}
              {d.sections?.map((section) => (
                <DrawerSection key={section.title} title={t(`detail.section.${section.title}`)}>
                  {section.rows && section.rows.length > 0 && (
                    <KVGrid entries={section.rows.filter((r) => r.value !== '').map((r) => [r.label, r.value])} />
                  )}
                  {section.table && (
                    <Box sx={{ overflowX: 'auto' }}>
                      <Box component="table" sx={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.78rem' }}>
                        <Box component="thead">
                          <Box component="tr">
                            {section.table.columns.map((c) => (
                              <Box component="th" key={c} sx={{ textAlign: 'left', opacity: 0.6, fontWeight: 600, p: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}>{c}</Box>
                            ))}
                          </Box>
                        </Box>
                        <Box component="tbody">
                          {section.table.rows.map((r, ri) => (
                            <Box component="tr" key={ri}>
                              {r.map((cell, ci) => (
                                <Box component="td" key={ci} sx={{ p: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}>{cell}</Box>
                              ))}
                            </Box>
                          ))}
                        </Box>
                      </Box>
                      {section.table.truncated && (
                        <Box sx={{ fontSize: '0.72rem', opacity: 0.6, mt: 0.5 }}>{t('detail.truncated')}</Box>
                      )}
                    </Box>
                  )}
                </DrawerSection>
              ))}

              {/* Owners */}
              {d.owners && d.owners.length > 0 && (
                <DrawerSection title={t('section.owners')} icon="ri-links-line" count={d.owners.length}>
                  <KVGrid entries={d.owners.map((o) => [o.kind, o.name])} />
                </DrawerSection>
              )}

              {/* Labels */}
              {Object.keys(d.labels ?? {}).length > 0 && (
                <DrawerSection title={t('section.labels')} icon="ri-price-tag-3-line" count={Object.keys(d.labels).length} defaultOpen={false}>
                  <KVGrid entries={Object.entries(d.labels)} />
                </DrawerSection>
              )}

              {/* Annotations */}
              {Object.keys(d.annotations ?? {}).length > 0 && (
                <DrawerSection title={t('section.annotations')} icon="ri-sticky-note-line" count={Object.keys(d.annotations).length} defaultOpen={false}>
                  <KVGrid entries={Object.entries(d.annotations)} />
                </DrawerSection>
              )}
            </Box>
          )}

          {tab === 1 && (
            <Box
              component="pre"
              sx={{ fontFamily: 'monospace', fontSize: '0.8rem', whiteSpace: 'pre-wrap', maxHeight: 480, overflow: 'auto', mt: 1 }}
            >
              {d?.yaml || ''}
            </Box>
          )}

          {tab === 2 && (
            <Box sx={{ mt: 1 }}>
              {(events?.items || []).length === 0 ? (
                <Typography variant="body2" color="text.secondary">{t('events.empty')}</Typography>
              ) : (
                (events?.items || []).map((e, i) => (
                  <Typography key={i} variant="body2">
                    [{e.type}] {e.reason}: {e.message}
                  </Typography>
                ))
              )}
            </Box>
          )}

          {isPod && tab === 3 && item.namespace && (
            <PodLogsPanel
              clusterId={clusterId}
              namespace={item.namespace}
              pod={item.name}
              containers={containers}
            />
          )}
          </Box>
        </Box>
      )}
    </Drawer>
  )
}
