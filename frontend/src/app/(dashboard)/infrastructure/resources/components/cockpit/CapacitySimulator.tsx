'use client'

import { useMemo, useState } from 'react'

import { Box, Chip, FormControlLabel, Grid, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useTranslations } from 'next-intl'

import NumericTextField from '@/components/ui/NumericTextField'

import type { ClusterCapacity, NodeCapacity, ResourceThresholds } from '../../types'
import {
  VM_TEMPLATE_PRESETS,
  simulateScenario,
  type PlanningAssumptions,
  type Scenario,
  type ScenarioResult,
} from '../../algorithms/capacityPlanning'
import { COLORS } from '../../constants'
import { SectionCard, UsageBar } from './ui'

// Same height as a small text input (a small Select is 2 px taller by default).
const SMALL_SELECT_SX = { '& .MuiInputBase-input.MuiSelect-select': { minHeight: '1.4375em', lineHeight: '1.4375em' } }

type PresetKey = keyof typeof VM_TEMPLATE_PRESETS | 'custom'

function presetOf(assumptions: PlanningAssumptions): PresetKey {
  const entry = Object.entries(VM_TEMPLATE_PRESETS).find(([, tpl]) => tpl.vcpu === assumptions.template.vcpu && tpl.ramGiB === assumptions.template.ramGiB)

  return (entry?.[0] as PresetKey) ?? 'custom'
}

function ResultColumn({ title, result, thresholds, highlight }: { title: string; result: ScenarioResult; thresholds: ResourceThresholds; highlight?: boolean }) {
  const t = useTranslations()
  const ok = result.ramOk && result.cpuOk
  const color = ok ? COLORS.success : COLORS.error

  return (
    <Box sx={{ p: 2, borderRadius: 2, border: '1px solid', borderColor: highlight ? alpha(color, 0.5) : 'divider', bgcolor: highlight ? alpha(color, 0.04) : 'transparent', height: '100%' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
        <Typography variant="subtitle2" fontWeight={700}>{title}</Typography>
        <Chip size="small" label={ok ? t('resources.cockpit.simFits') : t('resources.cockpit.simOver')} sx={{ fontWeight: 700, bgcolor: alpha(color, 0.12), color }} />
      </Stack>
      <Stack spacing={1.25}>
        <Box>
          <Typography variant="caption" color="text.secondary">RAM</Typography>
          <UsageBar pct={result.ramPct} warning={thresholds.ram.warning} critical={thresholds.ram.critical} />
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">CPU</Typography>
          <UsageBar pct={result.cpuPct} warning={thresholds.cpu.warning} critical={thresholds.cpu.critical} />
        </Box>
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="body2" color="text.secondary">vCPU:pCPU</Typography>
          <Typography variant="body2" fontWeight={700}>{result.vcpuRatio.toFixed(1)}:1</Typography>
        </Stack>
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="body2" color="text.secondary">{t('resources.cockpit.simHeadroom')}</Typography>
          <Typography variant="body2" fontWeight={700}>{result.headroom.count}</Typography>
        </Stack>
      </Stack>
    </Box>
  )
}

export default function CapacitySimulator({ clusters, nodes, thresholds, assumptions, onAssumptionsChange, initialClusterId, initialScenario }: {
  clusters: ClusterCapacity[]
  nodes: NodeCapacity[]
  thresholds: ResourceThresholds
  assumptions: PlanningAssumptions
  onAssumptionsChange: (next: PlanningAssumptions) => void
  initialClusterId?: string
  /** Scenario to open on, e.g. the loss of the largest node for a failing N+1. */
  initialScenario?: Scenario
}) {
  const t = useTranslations()
  const [clusterId, setClusterId] = useState<string>(initialClusterId ?? clusters[0]?.id ?? '')
  const [scenario, setScenario] = useState<Scenario>(initialScenario ?? { addVms: 10, loseLargestNode: false, addNodes: 0 })
  const scopeId = clusters.some(c => c.id === clusterId) ? clusterId : clusters[0]?.id ?? ''
  const scopeNodes = useMemo(() => nodes.filter(n => n.connectionId === scopeId), [nodes, scopeId])
  const preset = presetOf(assumptions)

  const today = useMemo(() => simulateScenario(scopeNodes, { addVms: 0, loseLargestNode: false, addNodes: 0 }, assumptions, thresholds), [scopeNodes, assumptions, thresholds])
  const after = useMemo(() => simulateScenario(scopeNodes, scenario, assumptions, thresholds), [scopeNodes, scenario, assumptions, thresholds])
  const setTemplate = (vcpu: number, ramGiB: number) => onAssumptionsChange({ ...assumptions, template: { vcpu, ramGiB } })

  return (
    <SectionCard id="cockpit-simulator" icon="ri-flask-line" title={t('resources.cockpit.simulator')} subtitle={t('resources.cockpit.simulatorSub')}>
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 5 }}>
          <Stack spacing={2}>
            <TextField select size="small" label={t('resources.cluster')} value={scopeId} onChange={e => setClusterId(e.target.value)} sx={SMALL_SELECT_SX} fullWidth>
              {clusters.map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </TextField>

            <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1 }}>{t('resources.cockpit.simTemplate')}</Typography>
            <TextField
              select size="small" label={t('resources.cockpit.simTemplateSize')} value={preset} sx={SMALL_SELECT_SX} fullWidth
              onChange={e => {
                const key = e.target.value as PresetKey
                if (key !== 'custom') setTemplate(VM_TEMPLATE_PRESETS[key].vcpu, VM_TEMPLATE_PRESETS[key].ramGiB)
              }}
            >
              {(Object.keys(VM_TEMPLATE_PRESETS) as Array<keyof typeof VM_TEMPLATE_PRESETS>).map(key => (
                <MenuItem key={key} value={key}>
                  {t('resources.cockpit.simPreset', { name: key.toUpperCase(), vcpu: VM_TEMPLATE_PRESETS[key].vcpu, ram: VM_TEMPLATE_PRESETS[key].ramGiB })}
                </MenuItem>
              ))}
              <MenuItem value="custom">{t('resources.cockpit.simCustom')}</MenuItem>
            </TextField>
            <Stack direction="row" spacing={2}>
              <NumericTextField
                type="number" size="small" label="vCPU" fullWidth
                value={assumptions.template.vcpu} fallback={4} min={1} max={512}
                onChange={v => setTemplate(Math.min(512, Math.max(1, Math.trunc(v))), assumptions.template.ramGiB)}
              />
              <NumericTextField
                type="number" size="small" label={t('resources.cockpit.simRamGiB')} fullWidth
                value={assumptions.template.ramGiB} fallback={8} min={1} max={8192}
                onChange={v => setTemplate(assumptions.template.vcpu, Math.min(8192, Math.max(1, Math.trunc(v))))}
              />
            </Stack>
            <NumericTextField
              type="number" size="small" label={t('resources.cockpit.simMaxRatio')} fullWidth
              value={assumptions.maxVcpuRatio} fallback={4} min={1} max={64} parse={Number.parseFloat}
              onChange={v => onAssumptionsChange({ ...assumptions, maxVcpuRatio: Math.min(64, Math.max(1, v)) })}
            />

            <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1 }}>{t('resources.cockpit.simScenario')}</Typography>
            <Stack direction="row" spacing={2}>
              <NumericTextField
                type="number" size="small" label={t('resources.cockpit.simAddVms')} fullWidth
                value={scenario.addVms} fallback={0} min={0} max={10000}
                onChange={v => setScenario(s => ({ ...s, addVms: Math.min(10000, Math.max(0, Math.trunc(v))) }))}
              />
              <NumericTextField
                type="number" size="small" label={t('resources.cockpit.simAddNodes')} fullWidth
                value={scenario.addNodes} fallback={0} min={0} max={100}
                onChange={v => setScenario(s => ({ ...s, addNodes: Math.min(100, Math.max(0, Math.trunc(v))) }))}
              />
            </Stack>
            <FormControlLabel
              control={<Switch size="small" checked={scenario.loseLargestNode} onChange={(_e, checked) => setScenario(s => ({ ...s, loseLargestNode: checked }))} />}
              label={<Typography variant="body2">{t('resources.cockpit.simLoseNode')}</Typography>}
            />
          </Stack>
        </Grid>
        <Grid size={{ xs: 12, md: 7 }}>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6 }}><ResultColumn title={t('resources.cockpit.simToday')} result={today} thresholds={thresholds} /></Grid>
            <Grid size={{ xs: 12, sm: 6 }}><ResultColumn title={t('resources.cockpit.simAfter')} result={after} thresholds={thresholds} highlight /></Grid>
          </Grid>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>{t('resources.cockpit.simMethod')}</Typography>
        </Grid>
      </Grid>
    </SectionCard>
  )
}
