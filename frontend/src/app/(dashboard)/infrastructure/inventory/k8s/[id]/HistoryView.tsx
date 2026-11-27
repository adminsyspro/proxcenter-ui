'use client'
import { useEffect, useMemo, useState } from 'react'
import { Alert, Box, CircularProgress, FormControlLabel, Pagination, Switch, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'
import { kindByApiKind } from '@/lib/k8s/resourceKinds'
import { relativeAge } from '@/lib/k8s/overviewCharts'
import type { TimelineEntry } from '@/lib/k8s/server/timeline'
import type { K8sResourceKind, ResourceListItem } from '@/lib/k8s/types'
import { KindIcon } from './KindIcon'

const PAGE_SIZE = 25
type SourceFilter = 'all' | TimelineEntry['source']

const SOURCE_ICON: Record<TimelineEntry['source'], string> = {
  event: 'ri-notification-3-line',
  rollout: 'ri-history-line',
  action: 'ri-user-settings-line',
}

export function isWarning(e: TimelineEntry): boolean {
  return (e.source === 'event' && e.type === 'Warning') || (e.source === 'action' && e.status !== 'success')
}

/** History of the cluster: events, rollout revisions and ProxCenter actions, newest first. */
export function HistoryView({
  clusterId, namespace, refreshTick = 0, onOpenResource,
}: {
  clusterId: string
  namespace?: string
  refreshTick?: number
  onOpenResource?: (kind: K8sResourceKind, item: ResourceListItem) => void
}) {
  const t = useTranslations('kubernetes.history')
  const tKind = useTranslations('kubernetes.explorer.kind')
  const [entries, setEntries] = useState<TimelineEntry[] | null>(null)
  const [partial, setPartial] = useState(false)
  const [error, setError] = useState(false)
  const [source, setSource] = useState<SourceFilter>('all')
  const [warningsOnly, setWarningsOnly] = useState(false)
  const [page, setPage] = useState(1)

  useEffect(() => {
    const ac = new AbortController()
    setError(false)
    const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''
    fetch(`/api/v1/k8s/clusters/${clusterId}/history${qs}`, { signal: ac.signal })
      .then(async res => {
        const body = await res.json().catch(() => null)
        if (!res.ok) { setError(true); setEntries([]); return }
        setEntries(body?.entries ?? [])
        setPartial(!!body?.partial)
      })
      .catch(err => { if ((err as Error).name !== 'AbortError') { setError(true); setEntries([]) } })
    return () => ac.abort()
  }, [clusterId, namespace, refreshTick])

  const filtered = useMemo(
    () => (entries ?? []).filter(e => (source === 'all' || e.source === source) && (!warningsOnly || isWarning(e))),
    [entries, source, warningsOnly],
  )
  useEffect(() => { setPage(1) }, [source, warningsOnly, namespace])
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const shown = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const text = (e: TimelineEntry): string => {
    if (e.source === 'event') return `${e.reason}: ${e.message}${e.count > 1 ? ` (x${e.count})` : ''}`
    if (e.source === 'rollout') {
      if (e.change === 'image') return t('rollout', { revision: e.revision, from: e.previousImages.join(', '), to: e.images.join(', ') })
      return t(e.change === 'restart' ? 'rolloutRestart' : 'rolloutConfig', { revision: e.revision })
    }
    const d = e.details ?? {}
    const key = e.action === 'cordon' && d.unschedulable === false ? 'uncordon' : e.action
    const label = t.has(`action.${key}`)
      ? t(`action.${key}`, { count: Number(d.replicas ?? 0), revision: Number(d.revision ?? 0) })
      : e.action
    return [label, e.status !== 'success' ? t('failed') : '', e.user ? t('by', { user: e.user }) : ''].filter(Boolean).join(' ')
  }

  const open = (e: TimelineEntry) => {
    const kd = kindByApiKind(e.kind)
    if (!kd || !onOpenResource) return
    onOpenResource(kd.apiKind, { kind: kd.apiKind, name: e.name, namespace: e.namespace, uid: '', createdAt: '', summary: {} })
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <ToggleButtonGroup size="small" exclusive value={source} onChange={(_, v) => { if (v) setSource(v) }}>
          {(['all', 'event', 'rollout', 'action'] as const).map(s => (
            <ToggleButton key={s} value={s} sx={{ px: 1.5, textTransform: 'none' }}>{t(`filter.${s}`)}</ToggleButton>
          ))}
        </ToggleButtonGroup>
        <FormControlLabel control={<Switch size="small" checked={warningsOnly} onChange={e => setWarningsOnly(e.target.checked)} />} label={t('warningsOnly')} />
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" color="text.secondary">{t('retention')}</Typography>
      </Box>

      {partial && <Alert severity="warning">{t('partial')}</Alert>}
      {error && <Alert severity="error">{t('error')}</Alert>}
      {entries === null && <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={24} /></Box>}
      {entries !== null && !error && filtered.length === 0 && <Typography color="text.secondary">{t('empty')}</Typography>}

      <Box>
        {shown.map((e, idx) => {
          const kd = kindByApiKind(e.kind)
          const warn = isWarning(e)
          const clickable = !!kd && !!onOpenResource
          return (
            <Box
              key={`${e.at}-${idx}`}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              onClick={() => open(e)}
              onKeyDown={ev => { if (clickable && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); open(e) } }}
              sx={{
                display: 'flex', alignItems: 'center', gap: 1, py: 0.6, px: 0.75, borderRadius: 1, minWidth: 0,
                borderBottom: '1px solid', borderColor: 'divider',
                cursor: clickable ? 'pointer' : 'default',
                '&:hover, &:focus-visible': clickable ? { bgcolor: 'action.hover', outline: 'none' } : undefined,
              }}
            >
              <Typography variant="caption" color="text.secondary" sx={{ width: 44, flexShrink: 0, textAlign: 'right' }} title={e.at}>
                {relativeAge(e.at)}
              </Typography>
              <Box
                component="i"
                className={SOURCE_ICON[e.source]}
                title={t(`filter.${e.source}`)}
                sx={{ fontSize: 16, flexShrink: 0, color: warn ? 'warning.main' : 'text.secondary' }}
              />
              <Box title={kd ? tKind(kd.apiKind) : e.kind} sx={{ display: 'flex', flexShrink: 0, color: 'text.secondary' }}>
                <KindIcon icon={kd?.icon ?? 'ri-ship-2-line'} iconImg={kd?.iconImg} size={15} />
              </Box>
              <Typography noWrap sx={{ fontWeight: 600, fontSize: '0.875rem', flexShrink: 1, minWidth: 0, maxWidth: '30%' }} title={e.name}>{e.name}</Typography>
              {e.namespace && <Typography noWrap variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>{e.namespace}</Typography>}
              <Typography noWrap variant="body2" sx={{ flex: 1, minWidth: 0, color: 'text.secondary' }} title={text(e)}>
                {text(e)}
              </Typography>
            </Box>
          )
        })}
      </Box>

      {pages > 1 && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Pagination size="small" count={pages} page={page} onChange={(_, p) => setPage(p)} />
        </Box>
      )}
    </Box>
  )
}
