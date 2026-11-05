'use client'

// Provider-side editor of a vDC's GPU contingent (#672), shown as one row of
// the vDC dialog's Quotas tab with the same columns as the other quotas:
// label, switch, count, then the profile picker, what the line holds on the
// right, and remove / add buttons. Each further profile takes one more line
// below with the same columns. Off means no contingent line at all. The
// dialog's own save writes the contingent through the save() handle, only
// when it changed.
// GET/PUT /api/v1/vdcs/{id}/gpu/quota; hidden without gpu_management and when
// the route answers 403 or 404.
import { useCallback, useContext, useEffect, useImperativeHandle, useMemo, useState, type Ref } from 'react'

import { Box, IconButton, MenuItem, Select, Stack, TextField, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import LicenseContext, { Features } from '@/contexts/LicenseContext'
import { isComputeProfile, parseProfile } from '@/lib/gpu/vgpu'

import { QUOTA_INPUT_SX, QUOTA_ROW_SX, QUOTA_TRAIL_WIDTH, QuotaRowLead, SMALL_SELECT_SX } from './VdcQuotaRow'

type Kind = 'vgpu' | 'whole'

type Entry = {
  id: string
  kind: Kind
  modelKey: string
  modelName: string
  profileName: string
  count: number
  held: number
  overCommitted: boolean
}

type Offer = {
  kind: Kind
  modelKey: string
  modelName: string
  profileName: string
  fbMemory: number | null
  freeNow: number | null
}

// What the card models of the vDC's cluster add up to (MiB for the frame buffer).
type Capacity = { modelKey: string; modelName: string; fbTotal: number; wholeCards: number; partial: boolean }

type View = { entries: Entry[]; offers: Offer[]; capacity?: Capacity[]; readable: boolean }

// One editable line: the picked profile (empty until chosen) and the count,
// kept as a string while the admin types.
type Line = {
  key: string
  kind: Kind
  modelKey: string
  modelName: string
  profileName: string
  count: string
}

type Status = 'loading' | 'ready' | 'hidden' | 'error'

export type VdcGpuQuotaHandle = {
  /** Writes the contingent of the vDC when it changed; false when the write failed. */
  save: (vdcId: string) => Promise<boolean>
}

const MAX_COUNT = 64
const MIB_PER_GIB = 1024
// Width of one icon button, so lines without the add button keep their columns.
const ICON_SLOT = 30

const ELLIPSIS_SX = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const

const lineKey = (r: { kind: Kind; modelKey: string; profileName: string }) =>
  `${r.kind}|${r.modelKey}|${r.profileName}`

const picked = (l: Line) => l.modelKey !== ''

const toLines = (entries: Entry[]): Line[] =>
  entries.map((e) => ({
    key: e.id,
    kind: e.kind,
    modelKey: e.modelKey,
    modelName: e.modelName,
    profileName: e.profileName,
    count: String(e.count),
  }))

const EMPTY_LINE: Line = { key: 'blank-0', kind: 'vgpu', modelKey: '', modelName: '', profileName: '', count: '' }
let blankSeq = 0
const blankLine = (): Line => ({ ...EMPTY_LINE, key: `blank-${++blankSeq}` })

const signature = (lines: Line[]) => JSON.stringify(lines.map((l) => [lineKey(l), l.count]))

const validCount = (s: string) => /^\d+$/.test(s) && Number(s) >= 1 && Number(s) <= MAX_COUNT

const gibOf = (fbMemory: number | null) => (fbMemory ? Math.round(fbMemory / MIB_PER_GIB) : null)

// A and B profiles (virtual applications, virtual PC) carry no CUDA worth the name.
const noCuda = (l: { kind: Kind; profileName: string }) =>
  l.kind === 'vgpu' && parseProfile(l.profileName) !== null && !isComputeProfile(l.profileName)

// "GA102GL [RTX A5000]" -> "RTX A5000": the marketing name when the PCI name carries one.
const shortModel = (name: string) => /\[([^\]]+)\]/.exec(name)?.[1] ?? name

type Props = {
  /** Null while the vDC is being created: there is nothing to read yet. */
  vdcId: string | null
  ref?: Ref<VdcGpuQuotaHandle>
  /** Told whether a count is out of range, so the dialog can hold its save. */
  onInvalidChange?: (invalid: boolean) => void
}

export default function VdcGpuQuotaEditor({ vdcId, ref, onInvalidChange }: Props) {
  const t = useTranslations()
  // Read the context directly: the editor is mounted in dialogs that may sit
  // outside a LicenseProvider, where it simply stays hidden.
  const license = useContext(LicenseContext)
  const licensed = !!license?.hasFeature(Features.GPU_MANAGEMENT)

  const [status, setStatus] = useState<Status>(vdcId ? 'loading' : 'ready')
  const [enabled, setEnabled] = useState(false)
  const [lines, setLines] = useState<Line[]>([])
  const [baseline, setBaseline] = useState('[]')
  const [heldBy, setHeldBy] = useState<Map<string, number>>(new Map())
  const [offers, setOffers] = useState<Offer[]>([])
  const [readable, setReadable] = useState(true)
  const [capacity, setCapacity] = useState<Capacity[]>([])
  const [saveError, setSaveError] = useState(false)

  const apply = useCallback((view: View) => {
    const next = toLines(view.entries)
    setLines(next)
    setBaseline(signature(next))
    setEnabled(next.length > 0)
    setHeldBy(new Map(view.entries.map((e) => [lineKey(e), e.held])))
    setOffers(view.offers)
    setReadable(view.readable)
    setCapacity(view.capacity ?? [])
  }, [])

  useEffect(() => {
    if (!licensed || !vdcId) return
    let cancelled = false
    setStatus('loading')
    void (async () => {
      try {
        const res = await fetch(`/api/v1/vdcs/${encodeURIComponent(vdcId)}/gpu/quota`)
        if (cancelled) return
        if (res.status === 403 || res.status === 404) { setStatus('hidden'); return }
        if (!res.ok) { setStatus('error'); return }
        const body = await res.json()
        if (cancelled) return
        apply(body.data)
        setStatus('ready')
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()
    return () => { cancelled = true }
  }, [vdcId, licensed, apply])

  // Off writes an empty contingent; the lines are kept so on brings them back.
  // A line without a profile is not part of the contingent.
  const desired = useMemo(() => (enabled ? lines.filter(picked) : []), [enabled, lines])
  const dirty = signature(desired) !== baseline
  const invalid = desired.some((l) => !validCount(l.count))
  const heldTotal = useMemo(() => [...heldBy.values()].reduce((s, n) => s + n, 0), [heldBy])

  // The picker lists the cluster's offers, plus any stored profile the cluster
  // does not offer right now so its line still shows what it holds.
  const choices = useMemo(() => {
    const out: Offer[] = [...offers]
    const known = new Set(offers.map(lineKey))
    for (const l of lines) {
      if (picked(l) && !known.has(lineKey(l))) {
        known.add(lineKey(l))
        out.push({ kind: l.kind, modelKey: l.modelKey, modelName: l.modelName, profileName: l.profileName, fbMemory: null, freeNow: null })
      }
    }
    return out
  }, [offers, lines])

  // The contingent is a ceiling, not a reservation: promising more than the
  // cluster's cards hold stays allowed, the row only says so. Recomputed as
  // the lines are edited. A model with an unread card is not judged.
  const overPromised = useMemo(() => {
    const promised = new Map<string, { mib: number; cards: number }>()
    for (const l of desired) {
      if (!validCount(l.count)) continue
      const p = promised.get(l.modelKey) ?? { mib: 0, cards: 0 }
      if (l.kind === 'whole') p.cards += Number(l.count)
      else {
        const fb = choices.find((c) => lineKey(c) === lineKey(l))?.fbMemory ?? (parseProfile(l.profileName)?.gib ?? 0) * MIB_PER_GIB
        p.mib += Number(l.count) * fb
      }
      promised.set(l.modelKey, p)
    }
    const out: Array<{ kind: Kind; model: string; promised: number; available: number }> = []
    for (const cap of capacity) {
      const p = promised.get(cap.modelKey)
      if (!p) continue
      const model = shortModel(cap.modelName)
      if (!cap.partial && p.mib > cap.fbTotal) {
        out.push({ kind: 'vgpu', model, promised: Math.round(p.mib / MIB_PER_GIB), available: Math.round(cap.fbTotal / MIB_PER_GIB) })
      }
      if (p.cards > cap.wholeCards) out.push({ kind: 'whole', model, promised: p.cards, available: cap.wholeCards })
    }
    return out
  }, [desired, choices, capacity])

  useEffect(() => { onInvalidChange?.(invalid) }, [invalid, onInvalidChange])

  useImperativeHandle(ref, () => ({
    save: async (id: string) => {
      if (!licensed || status !== 'ready' || !dirty) return true
      setSaveError(false)
      try {
        const res = await fetch(`/api/v1/vdcs/${encodeURIComponent(id)}/gpu/quota`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entries: desired.map((l) => ({
              kind: l.kind,
              modelKey: l.modelKey,
              modelName: l.modelName,
              profileName: l.profileName,
              count: Number(l.count),
            })),
          }),
        })
        if (!res.ok) { setSaveError(true); return false }
        const body = await res.json()
        apply(body.data)
        return true
      } catch {
        setSaveError(true)
        return false
      }
    },
  }), [licensed, status, dirty, desired, apply])

  if (!licensed || status === 'hidden') return null

  const labelOf = (r: { kind: Kind; modelName: string; profileName: string }) =>
    `${r.modelName} · ${r.kind === 'whole' ? t('vdc.gpuQuota.whole') : r.profileName}`

  // On, the row always shows at least one line, empty until a profile is picked.
  const shown = lines.length > 0 ? lines : [EMPTY_LINE]

  const edit = (fn: (prev: Line[]) => Line[]) => {
    setSaveError(false)
    setLines((prev) => fn(prev.length > 0 ? prev : shown))
  }

  const pick = (key: string, value: string) => {
    const o = choices.find((c) => lineKey(c) === value)
    if (!o) return
    edit((prev) => prev.map((l) => (l.key === key
      ? { ...l, kind: o.kind, modelKey: o.modelKey, modelName: o.modelName, profileName: o.profileName, count: l.count || '1' }
      : l)))
  }

  const lastLine = shown[shown.length - 1]
  const usedKeys = new Set(shown.filter(picked).map(lineKey))
  const canAdd = picked(lastLine) && choices.some((c) => !usedKeys.has(lineKey(c)))
  // The cluster was read and has no GPU to offer: nothing to switch on unless
  // lines are already stored (cards removed since), which stay editable.
  const clusterEmpty = status === 'ready' && !!vdcId && readable && offers.length === 0
  const noGpu = clusterEmpty && lines.length === 0

  // One line of text next to the switch when the count and picker are not
  // shown: a load or save failure, what turning the switch off leaves in
  // place, or the creation case. With the lines shown, a save failure goes
  // under them.
  let notice: { text: string; color: string; icon?: string } | null = null
  if (status === 'error') notice = { text: t('vdc.gpuQuota.errors.load'), color: 'error.main', icon: 'ri-error-warning-line' }
  else if (saveError) notice = { text: t('vdc.gpuQuota.errors.save'), color: 'error.main', icon: 'ri-error-warning-line' }
  else if (noGpu) notice = { text: t('vdc.gpuQuota.noGpu'), color: 'text.secondary', icon: 'ri-information-line' }
  else if (!enabled && heldTotal > 0) notice = { text: t('vdc.gpuQuota.offHeld'), color: 'warning.main', icon: 'ri-alert-line' }
  else if (enabled && !vdcId) notice = { text: t('vdc.gpuQuota.afterCreate'), color: 'text.secondary' }

  const showLines = enabled && !noGpu && !!vdcId && status === 'ready'

  // Label and switch. The lines under the first one carry an invisible copy
  // so their count and picker sit in exactly the same columns, whatever the
  // width of the label in the current language.
  const lead = (ghost = false) => (
    <Box
      aria-hidden={ghost || undefined}
      inert={ghost || undefined}
      sx={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0, ...(ghost && { visibility: 'hidden' }) }}
    >
      <QuotaRowLead
        label={t('vdc.gpuQuota.label')}
        ariaLabel={ghost ? undefined : t('vdc.gpuQuota.label')}
        checked={enabled && !noGpu}
        disabled={ghost || status !== 'ready' || noGpu}
        caption={enabled && !noGpu ? t('vdc.gpuQuota.on') : t('vdc.gpuQuota.off')}
        onChange={(v) => { setSaveError(false); setEnabled(v) }}
      />
    </Box>
  )

  const oneLine = (text: string, color: string, icon?: string, testId = 'gpu-quota-notice') => (
    <Tooltip title={text} arrow>
      <Typography
        variant="caption"
        color={color}
        data-testid={testId}
        sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}
      >
        {icon && <i className={icon} style={{ fontSize: 16, flexShrink: 0 }} />}
        <Box component="span" sx={ELLIPSIS_SX}>{text}</Box>
      </Typography>
    </Tooltip>
  )

  if (!showLines) {
    return (
      <Box data-testid="gpu-quota" sx={QUOTA_ROW_SX}>
        {lead()}
        {notice && oneLine(notice.text, notice.color, notice.icon)}
      </Box>
    )
  }

  return (
    <Box data-testid="gpu-quota" sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {shown.map((l, i) => {
        const isPicked = picked(l)
        const label = isPicked ? labelOf(l) : ''
        // The picker is narrow: a vGPU profile name already names its card.
        const shortLabel = `${l.kind === 'vgpu' ? l.profileName : label}${noCuda(l) ? ` · ${t('vdc.gpuQuota.noCuda')}` : ''}`
        const offer = isPicked ? choices.find((c) => lineKey(c) === lineKey(l)) : undefined
        const gib = l.kind === 'vgpu' ? gibOf(offer?.fbMemory ?? null) : null
        const held = isPicked ? heldBy.get(lineKey(l)) ?? 0 : 0
        const over = isPicked && validCount(l.count) && held > Number(l.count)
        const countError = isPicked && !validCount(l.count)
        // Nothing this line could take: the menu says so rather than open empty.
        const selectable = choices.some((c) => !usedKeys.has(lineKey(c)) || lineKey(c) === lineKey(l))
        const last = i === shown.length - 1
        return (
          <Box key={l.key} data-testid="gpu-quota-row" sx={{ ...QUOTA_ROW_SX, minWidth: 0 }}>
            {lead(i > 0)}
            <TextField
              size="small"
              type="number"
              value={l.count}
              error={countError}
              onChange={(e) => {
                const v = e.target.value
                edit((prev) => prev.map((x) => (x.key === l.key ? { ...x, count: v } : x)))
              }}
              slotProps={{ htmlInput: { min: 1, max: MAX_COUNT, 'aria-label': isPicked ? label : t('vdc.gpuQuota.count') } }}
              sx={{ ...QUOTA_INPUT_SX, flexShrink: 0 }}
            />
            <Select
              size="small"
              displayEmpty
              value={isPicked ? lineKey(l) : ''}
              onChange={(e) => pick(l.key, String(e.target.value))}
              inputProps={{ 'aria-label': t('vdc.gpuQuota.profile') }}
              renderValue={(v) => (v
                ? (
                  <Tooltip title={label} arrow placement="top">
                    <Box component="span" sx={{ ...ELLIPSIS_SX, display: 'block' }}>{shortLabel}</Box>
                  </Tooltip>
                )
                : <Box component="span" sx={{ ...ELLIPSIS_SX, display: 'block', color: 'text.disabled' }}>{t('vdc.gpuQuota.pick')}</Box>)}
              sx={{ flex: '1 1 0', minWidth: 0, ...SMALL_SELECT_SX }}
            >
              {!selectable && (
                <MenuItem value="" disabled>
                  <Typography variant="body2" sx={ELLIPSIS_SX}>{t('vdc.gpuQuota.noProfile')}</Typography>
                </MenuItem>
              )}
              {selectable && choices.map((o) => {
                const k = lineKey(o)
                const og = o.kind === 'vgpu' ? gibOf(o.fbMemory) : null
                return (
                  <MenuItem key={k} value={k} disabled={usedKeys.has(k) && k !== lineKey(l)}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
                      <Typography variant="body2" sx={ELLIPSIS_SX}>{labelOf(o)}</Typography>
                      {noCuda(o) && (
                        <Typography variant="caption" color="warning.main" sx={{ display: 'block', flexShrink: 0 }}>
                          {t('vdc.gpuQuota.noCuda')}
                        </Typography>
                      )}
                      {og !== null && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', flexShrink: 0 }}>
                          {t('vdc.gpuQuota.memory', { gb: og })}
                        </Typography>
                      )}
                      {o.freeNow !== null && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', flexShrink: 0 }}>
                          {t('vdc.gpuQuota.free', { count: o.freeNow })}
                        </Typography>
                      )}
                    </Box>
                  </MenuItem>
                )
              })}
            </Select>
            <Box sx={{ width: QUOTA_TRAIL_WIDTH, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
              <Stack direction="row" alignItems="center" justifyContent="flex-end" spacing={1} sx={{ flex: 1, minWidth: 0 }}>
                {i === 0 && !readable && oneLine(t('vdc.gpuQuota.unreadable'), 'text.secondary')}
                {over && (
                  <Tooltip title={t('vdc.gpuQuota.overCommitted')} arrow>
                    <Typography
                      variant="caption"
                      color="error"
                      sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0, flexShrink: 1 }}
                    >
                      <i className="ri-alert-line" style={{ flexShrink: 0 }} />
                      <Box component="span" sx={ELLIPSIS_SX}>{t('vdc.gpuQuota.overShort')}</Box>
                    </Typography>
                  </Tooltip>
                )}
                {isPicked && readable && (
                  <Typography
                    variant="caption"
                    data-over={over ? 'true' : 'false'}
                    color={over ? 'error' : 'text.secondary'}
                    sx={{ display: 'block', flexShrink: 0, whiteSpace: 'nowrap', fontWeight: over ? 600 : 400 }}
                  >
                    {t('vdc.gpuQuota.held', { count: held })}
                    {gib !== null && ` · ${t('vdc.gpuQuota.memory', { gb: gib })}`}
                  </Typography>
                )}
              </Stack>
              <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                <Tooltip title={t('vdc.gpuQuota.remove')} arrow>
                  <IconButton
                    size="small"
                    aria-label={t('vdc.gpuQuota.remove')}
                    onClick={() => edit((prev) => prev.filter((x) => x.key !== l.key))}
                  >
                    <i className="ri-delete-bin-line" />
                  </IconButton>
                </Tooltip>
                {last ? (
                  <Tooltip title={clusterEmpty ? t('vdc.gpuQuota.noGpu') : t('vdc.gpuQuota.add')} arrow>
                    <span>
                      <IconButton
                        size="small"
                        aria-label={t('vdc.gpuQuota.add')}
                        disabled={!canAdd}
                        onClick={() => edit((prev) => [...prev, blankLine()])}
                      >
                        <i className="ri-add-line" />
                      </IconButton>
                    </span>
                  </Tooltip>
                ) : (
                  <Box sx={{ width: ICON_SLOT }} />
                )}
              </Box>
            </Box>
          </Box>
        )
      })}
      {overPromised.length > 0 && (
        <Box data-testid="gpu-quota-overpromise" sx={{ ...QUOTA_ROW_SX, minWidth: 0 }}>
          {lead(true)}
          {oneLine(
            overPromised
              .map((o) => (o.kind === 'whole'
                ? t('vdc.gpuQuota.overCards', { model: o.model, promised: o.promised, available: o.available })
                : t('vdc.gpuQuota.overMemory', { model: o.model, promised: o.promised, available: o.available })))
              .join(' · '),
            'warning.main',
            'ri-alert-line',
            'gpu-quota-overpromise-text',
          )}
        </Box>
      )}
      {saveError && (
        <Box sx={{ ...QUOTA_ROW_SX, minWidth: 0 }}>
          {lead(true)}
          {oneLine(t('vdc.gpuQuota.errors.save'), 'error.main', 'ri-error-warning-line')}
        </Box>
      )}
    </Box>
  )
}
