'use client'
import { useEffect, useMemo, useState } from 'react'
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, MenuItem, Select, Switch, Typography,
} from '@mui/material'
import { useTranslations } from 'next-intl'
import type { KindDef } from '@/lib/k8s/resourceKinds'
import type { ResourceListItem } from '@/lib/k8s/types'
import { diffLines, normalizeForCompare, type DiffRow } from '@/lib/k8s/yamlDiff'

const itemKey = (i: ResourceListItem) => `${i.namespace ?? ''}/${i.name}`

async function fetchYaml(clusterId: string, kind: string, item: ResourceListItem, signal: AbortSignal): Promise<string | null> {
  const qs = new URLSearchParams({ kind, name: item.name })
  if (item.namespace) qs.set('namespace', item.namespace)
  const res = await fetch(`/api/v1/k8s/clusters/${clusterId}/resources?${qs}`, { signal })
  if (!res.ok) return null
  const body = await res.json().catch(() => null)
  return typeof body?.detail?.yaml === 'string' ? body.detail.yaml : null
}

const ROW_BG: Record<DiffRow['type'], { left?: string; right?: string }> = {
  same: {},
  changed: { left: 'rgba(33, 150, 243, 0.14)', right: 'rgba(33, 150, 243, 0.14)' },
  removed: { left: 'rgba(244, 67, 54, 0.14)' },
  added: { right: 'rgba(76, 175, 80, 0.16)' },
}

/** Side-by-side YAML of two resources of the same kind, without the fields Kubernetes manages. */
export function CompareDialog({
  clusterId, kind, base, candidates, onClose,
}: {
  clusterId: string
  kind: KindDef
  base: ResourceListItem
  candidates: ResourceListItem[]
  onClose: () => void
}) {
  const t = useTranslations('kubernetes.compare')
  const others = useMemo(() => candidates.filter(c => itemKey(c) !== itemKey(base)), [candidates, base])
  const [otherKey, setOtherKey] = useState(others[0] ? itemKey(others[0]) : '')
  const [texts, setTexts] = useState<{ left: string; right: string } | null>(null)
  const [error, setError] = useState(false)
  const [onlyChanges, setOnlyChanges] = useState(false)

  useEffect(() => {
    const other = others.find(o => itemKey(o) === otherKey)
    if (!other) return
    const ac = new AbortController()
    setTexts(null)
    setError(false)
    Promise.all([fetchYaml(clusterId, kind.apiKind, base, ac.signal), fetchYaml(clusterId, kind.apiKind, other, ac.signal)])
      .then(([left, right]) => {
        if (left === null || right === null) { setError(true); return }
        setTexts({ left: normalizeForCompare(left), right: normalizeForCompare(right) })
      })
      .catch(err => { if ((err as Error).name !== 'AbortError') setError(true) })
    return () => ac.abort()
  }, [clusterId, kind.apiKind, base, others, otherKey])

  const diff = useMemo(() => (texts ? diffLines(texts.left, texts.right) : null), [texts])
  const rows = diff ? (onlyChanges ? diff.rows.filter(r => r.type !== 'same') : diff.rows) : []
  const label = (i: ResourceListItem) => (i.namespace ? `${i.namespace} / ${i.name}` : i.name)

  const cell = (text: string | undefined, bg: string | undefined) => (
    <Box sx={{ px: 1, bgcolor: bg, whiteSpace: 'pre', minHeight: '1.4em', overflow: 'hidden', textOverflow: 'ellipsis' }} title={text}>
      {text ?? ''}
    </Box>
  )

  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>{t('title', { name: base.name })}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1.5 }}>
          <Typography sx={{ width: 140, flexShrink: 0 }}>{t('with')}</Typography>
          <Select size="small" value={otherKey} onChange={e => setOtherKey(e.target.value)} sx={{ minWidth: 320 }} disabled={others.length === 0}>
            {others.map(o => <MenuItem key={itemKey(o)} value={itemKey(o)}>{label(o)}</MenuItem>)}
          </Select>
          <Box sx={{ flex: 1 }} />
          <FormControlLabel
            control={<Switch size="small" checked={onlyChanges} onChange={e => setOnlyChanges(e.target.checked)} />}
            label={t('onlyChanges')}
          />
        </Box>

        {others.length === 0 && <Typography color="text.secondary">{t('noOther')}</Typography>}
        {error && <Alert severity="error">{t('error')}</Alert>}
        {others.length > 0 && !error && !diff && <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={24} /></Box>}

        {diff && (
          <>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              {diff.changes === 0 ? t('identical') : t('changes', { count: diff.changes })}
              {diff.truncated ? ` ${t('truncated')}` : ''}
            </Typography>
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, maxHeight: '60vh', overflow: 'auto' }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', position: 'sticky', top: 0, bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider', zIndex: 1 }}>
                <Typography variant="caption" sx={{ px: 1, py: 0.5, fontWeight: 600 }} noWrap>{label(base)}</Typography>
                <Typography variant="caption" sx={{ px: 1, py: 0.5, fontWeight: 600, borderLeft: '1px solid', borderColor: 'divider' }} noWrap>
                  {label(others.find(o => itemKey(o) === otherKey) ?? base)}
                </Typography>
              </Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', fontFamily: 'monospace', fontSize: '0.78rem', lineHeight: 1.4 }}>
                {rows.map((r, idx) => (
                  <Box key={idx} sx={{ display: 'contents' }}>
                    {cell(r.left, ROW_BG[r.type].left)}
                    <Box sx={{ borderLeft: '1px solid', borderColor: 'divider' }}>{cell(r.right, ROW_BG[r.type].right)}</Box>
                  </Box>
                ))}
              </Box>
            </Box>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('close')}</Button>
      </DialogActions>
    </Dialog>
  )
}
