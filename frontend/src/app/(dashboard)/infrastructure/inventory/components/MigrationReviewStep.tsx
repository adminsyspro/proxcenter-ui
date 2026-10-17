'use client'

/**
 * Second step of the VMware migration dialog (#317, lot 1): review and
 * customize the target VM before the job starts.
 *
 * Shows the hardware read from the source VM (cores, sockets, memory) as
 * editable fields, the CPU model of the target (the dialog's quick list plus
 * the node's own models from `cpu-models`), and one row per source NIC with
 * its vSphere network next to the target bridge (physical bridges and SDN
 * VNets from `network-choices`), an optional VLAN tag and an optional model.
 * The parent owns the state; this component only renders and edits it.
 */

import React, { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import Slider from '@mui/material/Slider'
import FormControl from '@mui/material/FormControl'
import FormHelperText from '@mui/material/FormHelperText'
import InputLabel from '@mui/material/InputLabel'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Alert from '@mui/material/Alert'
import CircularProgress from '@mui/material/CircularProgress'
import { useTheme } from '@mui/material/styles'

import { MIGRATION_CPU_TYPES, MIGRATION_CPU_TYPE_DEFAULT } from '@/lib/migration/cpu-type'
import { MIGRATION_NIC_MODELS, HARDWARE_LIMITS } from '@/lib/migration/target-overrides'
import {
  hardwareErrors, mergeCpuModels, sourceHardware, vlanTagInvalid,
  type ReviewHardwareState, type ReviewNicState, type ReviewSource,
} from './migrationReview'

export interface NetworkChoice {
  name: string
  label: string
  kind: 'bridge' | 'vnet' | 'shared'
}

/** Flatten a `network-choices` answer into picker rows (bridges first, then VNets). */
export function toNetworkChoices(data: unknown): NetworkChoice[] {
  if (!Array.isArray(data)) return []
  const out: NetworkChoice[] = []
  for (const raw of data) {
    const c = raw as Record<string, unknown> | null
    if (!c || typeof c.name !== 'string' || !c.name) continue
    if (c.kind === 'vnet') {
      const display = typeof c.displayName === 'string' && c.displayName !== c.name ? c.displayName : ''
      out.push({ name: c.name, kind: 'vnet', label: `VNet${display ? ` · ${display}` : ''}${typeof c.zone === 'string' && c.zone ? ` · ${c.zone}` : ''}` })
    } else if (c.kind === 'shared') {
      out.push({ name: c.name, kind: 'shared', label: typeof c.label === 'string' && c.label ? c.label : '' })
    } else {
      out.push({ name: c.name, kind: 'bridge', label: typeof c.type === 'string' && c.type !== 'bridge' ? c.type : '' })
    }
  }
  return [...out.filter(c => c.kind !== 'vnet'), ...out.filter(c => c.kind === 'vnet')]
}

const SELECT_SX = { '& .MuiInputBase-input.MuiSelect-select': { minHeight: '1.4375em', lineHeight: '1.4375em' } } as const

export interface MigrationReviewStepProps {
  source: ReviewSource | null
  sourceLoading: boolean
  sourceName: string
  targetConnId: string
  targetNode: string
  defaultBridge: string
  canEditVlan: boolean
  cpuType: string
  onCpuTypeChange: (value: string) => void
  hardware: ReviewHardwareState
  onHardwareChange: (next: ReviewHardwareState) => void
  nics: ReviewNicState[]
  onNicsChange: (next: ReviewNicState[]) => void
}

/** A slider over a value: linear for counts, by steps for memory (as the deploy wizard). */
interface HwSliderScale {
  top: number
  step: number
  max: number
  marks: { value: number; label: string }[]
  toSlider: (v: number) => number
  fromSlider: (s: number) => number
}

const linearScale = (min: number, max: number, marks: number[]): HwSliderScale => ({
  top: max - min,
  step: 1,
  max,
  marks: marks.map(m => ({ value: m - min, label: String(m) })),
  toSlider: v => Math.max(0, Math.min(max, v) - min),
  fromSlider: s => Math.round(s) + min,
})

/** "512 MiB", "4 GiB", "1.5 GiB". */
export function formatMiB(n: number): string {
  if (n < 1024) return `${n} MiB`
  const g = n / 1024
  return `${Number.isInteger(g) ? g : g.toFixed(1)} GiB`
}

// Memory: one slider stop per mark, interpolated between them, rounded to 256 MiB.
const MEMORY_MARKS = [512, 1024, 2048, 4096, 8192, 16384, 32768, 65536]
const MEMORY_SCALE: HwSliderScale = {
  top: MEMORY_MARKS.length - 1,
  step: 0.01,
  max: MEMORY_MARKS.at(-1)!,
  marks: MEMORY_MARKS.map((m, i) => ({ value: i, label: formatMiB(m) })),
  toSlider: v => {
    if (v <= MEMORY_MARKS[0]) return 0
    for (let i = 1; i < MEMORY_MARKS.length; i++) {
      if (v <= MEMORY_MARKS[i]) return i - 1 + (v - MEMORY_MARKS[i - 1]) / (MEMORY_MARKS[i] - MEMORY_MARKS[i - 1])
    }
    return MEMORY_MARKS.length - 1
  },
  fromSlider: s => {
    const i = Math.min(Math.floor(s), MEMORY_MARKS.length - 2)
    const v = MEMORY_MARKS[i] + (s - i) * (MEMORY_MARKS[i + 1] - MEMORY_MARKS[i])
    return Math.max(MEMORY_MARKS[0], Math.round(v / 256) * 256)
  },
}

const CORES_SCALE = linearScale(1, 32, [1, 4, 8, 16, 24, 32])
const SOCKETS_SCALE = linearScale(1, 4, [1, 2, 3, 4])

export default function MigrationReviewStep({
  source, sourceLoading, sourceName, targetConnId, targetNode, defaultBridge, canEditVlan,
  cpuType, onCpuTypeChange, hardware, onHardwareChange, nics, onNicsChange,
}: MigrationReviewStepProps) {
  const t = useTranslations()
  const theme = useTheme()
  const [choices, setChoices] = useState<NetworkChoice[]>([])
  const [cpuModels, setCpuModels] = useState<string[]>([...MIGRATION_CPU_TYPES])

  // Target bridges and VNets of the node, and its CPU models. Both lists are
  // best effort: without them the pickers still hold the default bridge and
  // the quick CPU list, so the step never blocks on a slow node.
  useEffect(() => {
    if (!targetConnId || !targetNode) return
    let cancelled = false
    const node = encodeURIComponent(targetNode)
    fetch(`/api/v1/connections/${encodeURIComponent(targetConnId)}/network-choices?node=${node}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setChoices(toNetworkChoices(d?.data)) })
      .catch(() => { if (!cancelled) setChoices([]) })
    fetch(`/api/v1/connections/${encodeURIComponent(targetConnId)}/nodes/${node}/cpu-models`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setCpuModels(mergeCpuModels(MIGRATION_CPU_TYPES, d?.data)) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [targetConnId, targetNode])

  const base = sourceHardware(source)
  const errors = hardwareErrors(hardware)
  const sectionSx = { p: 2, borderRadius: 1.5, bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)', border: '1px solid', borderColor: 'divider' } as const
  const titleSx = { mb: 1.5, color: 'text.secondary', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 } as const

  // Every bridge the rows can show: the node's choices, plus whatever a row
  // already holds (the default bridge of step 1 may come from another list).
  const bridgeOptions = (current: string): NetworkChoice[] => {
    const known = choices.some(c => c.name === current)
    return known || !current ? choices : [{ name: current, kind: 'bridge', label: '' }, ...choices]
  }

  const setHw = (field: keyof ReviewHardwareState, value: string) =>
    onHardwareChange({ ...hardware, [field]: value.replaceAll(/[^0-9]/g, '') })
  const setNic = (index: number, patch: Partial<ReviewNicState>) =>
    onNicsChange(nics.map((n, i) => (i === index ? { ...n, ...patch } : n)))

  // One row per value, as in the deploy wizard: label and value, then a slider
  // for the usual range and a field for an exact value (up to the hard limit).
  // An empty value keeps the source's; the slider shows what will apply.
  const hwRow = (field: keyof ReviewHardwareState, opts: { label: string; icon: string; testId: string; format: (n: number) => string; slider: HwSliderScale }) => {
    const { min, max } = HARDWARE_LIMITS[field]
    const effective = Number(hardware[field]) || base[field] || min
    const sc = opts.slider
    return (
      <Box key={field} data-testid={`${opts.testId}-row`}>
        <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mb: 0.5 }}>
          <Box component="i" className={opts.icon} sx={{ fontSize: 15, opacity: 0.7, alignSelf: 'center', display: 'inline-flex' }} />
          <Typography variant="caption" sx={{ opacity: 0.7, fontWeight: 600 }}>{opts.label}</Typography>
          <Typography variant="body2" sx={{ fontWeight: 700 }} data-testid={`${opts.testId}-value`}>{opts.format(effective)}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ pl: 1 }}>
            {t('inventoryPage.esxiMigration.reviewSourceValue', { value: base[field] ? opts.format(base[field]) : '?' })}
          </Typography>
        </Stack>
        <Stack direction="row" alignItems="center" spacing={4}>
          <Box sx={{ flex: 1, px: 3 }}>
            <Slider
              size="small"
              value={sc.toSlider(Math.min(effective, sc.max))}
              min={0}
              max={sc.top}
              step={sc.step}
              onChange={(_e, v) => setHw(field, String(sc.fromSlider(v as number)))}
              marks={sc.marks}
              valueLabelDisplay="auto"
              valueLabelFormat={() => opts.format(effective)}
              slotProps={{ input: { 'aria-label': opts.label } }}
              sx={{ '& .MuiSlider-markLabel': { fontSize: '0.65rem' } }}
            />
          </Box>
          <TextField
            size="small"
            type="number"
            value={hardware[field]}
            placeholder={base[field] ? String(base[field]) : ''}
            onChange={e => setHw(field, e.target.value)}
            error={errors[field]}
            helperText={errors[field] ? t('inventoryPage.esxiMigration.reviewRange', { min, max }) : undefined}
            inputProps={{ min, max, inputMode: 'numeric', 'data-testid': opts.testId }}
            sx={{ width: 120 }}
          />
        </Stack>
      </Box>
    )
  }

  return (
    <Stack spacing={2} sx={{ mt: 1 }} data-testid="migration-review-step">
      {sourceLoading && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CircularProgress size={14} />
          <Typography variant="caption">{t('inventoryPage.esxiMigration.reviewLoading')}</Typography>
        </Box>
      )}
      {!sourceLoading && !source && (
        <Alert severity="warning" sx={{ fontSize: 12 }}>{t('inventoryPage.esxiMigration.reviewLoadFailed')}</Alert>
      )}
      {source?.hasVtpm && (
        <Alert severity="warning" sx={{ fontSize: 12 }} data-testid="review-vtpm-warning">
          {t('inventoryPage.esxiMigration.reviewVtpmWarning')}
        </Alert>
      )}

      <Box sx={sectionSx}>
        <Typography variant="subtitle2" sx={titleSx}>{t('inventoryPage.esxiMigration.reviewHardware')}</Typography>
        <Stack spacing={2} sx={{ mb: 2 }}>
          {hwRow('cores', { label: t('inventoryPage.esxiMigration.reviewCores'), icon: 'ri-cpu-line', testId: 'review-cores', format: n => `${n}`, slider: CORES_SCALE })}
          {hwRow('sockets', { label: t('inventoryPage.esxiMigration.reviewSockets'), icon: 'ri-stack-line', testId: 'review-sockets', format: n => `${n}`, slider: SOCKETS_SCALE })}
          {hwRow('memoryMB', { label: t('inventoryPage.esxiMigration.reviewMemory'), icon: 'ri-ram-line', testId: 'review-memory', format: formatMiB, slider: MEMORY_SCALE })}
        </Stack>
        <FormControl fullWidth size="small" data-testid="review-cpu-type">
          <InputLabel>{t('inventoryPage.esxiMigration.cpuType')}</InputLabel>
          <Select
            value={cpuModels.includes(cpuType) ? cpuType : MIGRATION_CPU_TYPE_DEFAULT}
            onChange={e => onCpuTypeChange(String(e.target.value))}
            label={t('inventoryPage.esxiMigration.cpuType')}
            sx={SELECT_SX}
            MenuProps={{ PaperProps: { sx: { maxHeight: 320 } } }}
          >
            {cpuModels.map(model => (
              <MenuItem key={model} value={model}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className="ri-cpu-line" style={{ fontSize: 14, opacity: 0.7 }} />
                  <Typography variant="body2" fontWeight={500}>{model}</Typography>
                  {model === MIGRATION_CPU_TYPE_DEFAULT && (
                    <Typography variant="caption" sx={{ opacity: 0.5 }}>({t('inventoryPage.esxiMigration.cpuTypeDefault')})</Typography>
                  )}
                </Box>
              </MenuItem>
            ))}
          </Select>
          <FormHelperText>
            {t(cpuType === 'host' ? 'inventoryPage.esxiMigration.cpuTypeHostHint' : 'inventoryPage.esxiMigration.cpuTypeHint')}
          </FormHelperText>
        </FormControl>
      </Box>

      <Box sx={sectionSx}>
        <Typography variant="subtitle2" sx={titleSx}>{t('inventoryPage.esxiMigration.reviewNics')}</Typography>
        {nics.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            {t('inventoryPage.esxiMigration.reviewNoNic', { bridge: defaultBridge || 'vmbr0' })}
          </Typography>
        ) : (
          <Table size="small" sx={{ '& td, & th': { px: 0.75, py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }, '& th': { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.secondary', fontWeight: 600 } }}>
            <TableHead>
              <TableRow>
                <TableCell>{t('inventoryPage.esxiMigration.reviewNicAdapter')}</TableCell>
                <TableCell>{t('inventoryPage.esxiMigration.reviewNicSourceNetwork')}</TableCell>
                <TableCell sx={{ minWidth: 200 }}>{t('inventoryPage.esxiMigration.reviewNicBridge')}</TableCell>
                <TableCell sx={{ width: 96, whiteSpace: 'nowrap' }}>{t('inventoryPage.esxiMigration.vlanTag')}</TableCell>
                <TableCell sx={{ width: 120 }}>{t('inventoryPage.esxiMigration.reviewNicModel')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {nics.map((nic, index) => {
                const src = source?.nics[index]
                const tagBad = vlanTagInvalid(nic.vlanTag)
                return (
                  <TableRow key={index} data-testid={`review-nic-${index}`}>
                    <TableCell>
                      <Typography variant="body2" fontWeight={500} noWrap>{src?.label || `net${index}`}</Typography>
                      <Typography variant="caption" sx={{ opacity: 0.6, display: 'block', fontFamily: '"JetBrains Mono", monospace', fontSize: 10 }}>
                        {[src?.type, src?.macAddress].filter(Boolean).join(' · ')}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <i className="ri-git-branch-line" style={{ fontSize: 14, opacity: 0.6 }} />
                        <Typography variant="body2" noWrap>{src?.network || '?'}</Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <FormControl fullWidth size="small" data-testid={`review-nic-${index}-bridge`} error={!nic.bridge}>
                        <Select
                          value={nic.bridge}
                          onChange={e => setNic(index, { bridge: String(e.target.value) })}
                          displayEmpty
                          sx={SELECT_SX}
                          renderValue={val => {
                            const c = choices.find(x => x.name === val)
                            return (
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <i className="ri-router-line" style={{ fontSize: 14, opacity: 0.7 }} />
                                <Typography variant="body2" fontWeight={500}>{String(val) || t('inventoryPage.esxiMigration.selectBridge')}</Typography>
                                {c?.label && <Typography variant="caption" sx={{ opacity: 0.5 }} noWrap>({c.label})</Typography>}
                              </Box>
                            )
                          }}
                        >
                          {bridgeOptions(nic.bridge).map(c => (
                            <MenuItem key={c.name} value={c.name}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                <i className={c.kind === 'vnet' ? 'ri-node-tree' : 'ri-router-line'} style={{ fontSize: 14, opacity: 0.7 }} />
                                <Typography variant="body2" fontWeight={500}>{c.name}</Typography>
                                {c.label && <Typography variant="caption" sx={{ opacity: 0.5, ml: 'auto' }}>{c.label}</Typography>}
                              </Box>
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        value={canEditVlan ? nic.vlanTag : ''}
                        disabled={!canEditVlan}
                        placeholder={t('inventoryPage.esxiMigration.vlanTagPlaceholder')}
                        onChange={e => setNic(index, { vlanTag: e.target.value.replaceAll(/[^0-9]/g, '') })}
                        error={tagBad}
                        sx={{ width: 84 }}
                        inputProps={{ inputMode: 'numeric', maxLength: 4, 'data-testid': `review-nic-${index}-vlan` }}
                      />
                    </TableCell>
                    <TableCell>
                      <FormControl fullWidth size="small" data-testid={`review-nic-${index}-model`}>
                        <Select value={nic.model} onChange={e => setNic(index, { model: String(e.target.value) })} displayEmpty sx={SELECT_SX}>
                          <MenuItem value="">{t('inventoryPage.esxiMigration.reviewNicModelAuto')}</MenuItem>
                          {MIGRATION_NIC_MODELS.map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                        </Select>
                      </FormControl>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Box>
    </Stack>
  )
}
