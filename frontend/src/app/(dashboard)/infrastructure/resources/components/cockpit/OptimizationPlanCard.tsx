'use client'

import { useState } from 'react'

import { Box, ButtonBase, Chip, Collapse, IconButton, Stack, Typography, useTheme } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useTranslations } from 'next-intl'

import PagedRows from '@/components/ui/PagedRows'
import { GuestGlyph, NodeGlyph } from '@/components/automation/drs/glyphs'
import type { OptimizationPlan, PlanGuest, PlanItem, PlanKind, PlanNode, PlanPriority } from '@/lib/resources/optimizationPlan'

import type { VmIdentity } from '../../types'
import { COLORS } from '../../constants'
import { formatBytes, parseResourceVmId } from '../../helpers'
import AiReadingCard from './AiReadingCard'
import { Conclusion, EmptyState } from './ui'

const KIND_ICON: Record<PlanKind, string> = {
  rightsize: 'ri-contract-left-right-line',
  dormant: 'ri-shut-down-line',
  rebalance: 'ri-arrow-left-right-line',
  overcommit: 'ri-cpu-line',
}

const PRIORITY_COLOR: Record<PlanPriority, string> = { high: COLORS.error, medium: COLORS.warning, low: COLORS.info }

const allocation = (vcpu: number, ramBytes: number) => `${vcpu} vCPU · ${formatBytes(ramBytes)}`

function GuestLine({ guest, onOpenVm }: { guest: PlanGuest; onOpenVm: (vm: VmIdentity) => void }) {
  const theme = useTheme()
  const { connId, type, node, vmid } = parseResourceVmId(guest.id)
  const dark = theme.palette.mode === 'dark'

  return (
    <ButtonBase
      onClick={() => onOpenVm({ id: guest.id, name: guest.name, node, connId, type, vmid })}
      sx={{ width: '100%', justifyContent: 'stretch', py: 0.5, px: 1, borderRadius: 1, '&:hover': { bgcolor: 'action.hover' } }}
    >
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ width: '100%', minWidth: 0 }}>
        <GuestGlyph type={type} status={guest.status} dotBorder={theme.palette.background.paper} />
        <Typography variant="body2" fontWeight={600} noWrap sx={{ width: { xs: 'auto', md: 240 }, flex: { xs: 1, md: 'none' }, minWidth: 0, textAlign: 'left' }}>{guest.name}</Typography>
        <Stack direction="row" alignItems="center" spacing={0.75} sx={{ width: 140, flexShrink: 0, display: { xs: 'none', sm: 'flex' } }}>
          <NodeGlyph status="online" dark={dark} dotBorder={theme.palette.background.paper} />
          <Typography variant="body2" color="text.secondary" noWrap>{guest.node}</Typography>
        </Stack>
        <Box sx={{ flex: 1, display: { xs: 'none', md: 'block' } }} />
        <Typography variant="body2" color="text.secondary" noWrap sx={{ width: 150, flexShrink: 0, textAlign: 'right' }}>{allocation(guest.vcpu, guest.ramBytes)}</Typography>
        {guest.targetVcpu !== undefined && (
          <>
            <Typography variant="body2" color="text.secondary" noWrap sx={{ width: 120, flexShrink: 0, textAlign: 'right', display: { xs: 'none', md: 'block' } }}>
              {`CPU ${guest.cpuPct}% · RAM ${guest.ramPct}%`}
            </Typography>
            <Stack direction="row" alignItems="center" spacing={0.5} sx={{ width: 170, flexShrink: 0, justifyContent: 'flex-end' }}>
              <i className="ri-arrow-right-line" style={{ fontSize: 14, color: COLORS.success }} />
              <Typography variant="body2" fontWeight={600} noWrap sx={{ color: COLORS.success }}>{allocation(guest.targetVcpu, guest.targetRamBytes ?? 0)}</Typography>
            </Stack>
          </>
        )}
      </Stack>
    </ButtonBase>
  )
}

function NodeLine({ node }: { node: PlanNode }) {
  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'

  return (
    <Stack direction="row" alignItems="center" spacing={1.5} sx={{ py: 0.5, px: 1 }}>
      <NodeGlyph status={node.online ? 'online' : 'offline'} dark={dark} dotBorder={theme.palette.background.paper} />
      <Typography variant="body2" fontWeight={600} noWrap sx={{ width: { xs: 'auto', md: 240 }, flex: { xs: 1, md: 'none' }, minWidth: 0 }}>{node.name}</Typography>
      <Box sx={{ flex: 1, display: { xs: 'none', md: 'block' } }} />
      <Typography variant="body2" color="text.secondary" noWrap sx={{ width: 90, textAlign: 'right' }}>{`RAM ${Math.round(node.ramPct)}%`}</Typography>
      <Typography variant="body2" color="text.secondary" noWrap sx={{ width: 90, textAlign: 'right' }}>{`CPU ${Math.round(node.cpuPct)}%`}</Typography>
      <Typography variant="body2" color="text.secondary" noWrap sx={{ width: 90, textAlign: 'right' }}>{`${node.vcpuRatio}:1`}</Typography>
    </Stack>
  )
}

function PlanRow({ item, onOpenVm }: { item: PlanItem; onOpenVm: (vm: VmIdentity) => void }) {
  const t = useTranslations()
  const [open, setOpen] = useState(false)
  const color = PRIORITY_COLOR[item.priority]
  const params = { ...item.facts, cluster: item.cluster ?? '', ram: formatBytes(item.gain.ramBytes), vcpu: item.gain.vcpu }

  let gain = '-'
  if (item.gain.vcpu > 0 || item.gain.ramBytes > 0) {
    gain = [item.gain.vcpu > 0 && `-${item.gain.vcpu} vCPU`, item.gain.ramBytes > 0 && `-${formatBytes(item.gain.ramBytes)}`].filter(Boolean).join(' · ')
  } else if (item.kind === 'rebalance') {
    gain = t('resources.optimization.gainSpread', { points: item.facts.points })
  }

  const explanation = item.explanationKey ? t(`resources.optimization.${item.explanationKey}`, params) : item.explanation
  const action = item.actionKey ? t(`resources.optimization.${item.actionKey}`, params) : item.action

  return (
    <Box sx={{ borderBottom: '1px solid', borderColor: 'divider', '&:last-of-type': { borderBottom: 0 } }}>
      <Stack direction="row" alignItems="center" spacing={1.5} onClick={() => setOpen(prev => !prev)} sx={{ py: 1, cursor: 'pointer' }}>
        <Box sx={{ width: 28, height: 28, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: alpha(COLORS.primary, 0.1), color: COLORS.primary, flexShrink: 0 }}>
          <i className={KIND_ICON[item.kind]} style={{ fontSize: 16 }} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" fontWeight={700} noWrap>{t(`resources.optimization.kind.${item.kind}`, params)}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>{t(`resources.optimization.finding.${item.kind}`, params)}</Typography>
        </Box>
        <Typography variant="body2" fontWeight={600} noWrap sx={{ width: 190, flexShrink: 0, textAlign: 'right', display: { xs: 'none', sm: 'block' } }}>{gain}</Typography>
        <Chip size="small" label={t(`resources.optimization.priority.${item.priority}`)} sx={{ width: 84, flexShrink: 0, fontWeight: 600, bgcolor: alpha(color, 0.12), color }} />
        <IconButton size="small" aria-expanded={open} aria-label={t(open ? 'resources.cockpit.collapse' : 'resources.cockpit.expand')}>
          <i className={open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} style={{ fontSize: 18 }} />
        </IconButton>
      </Stack>
      <Collapse in={open} unmountOnExit>
        <Stack spacing={1} sx={{ pl: 5.5, pr: 1, pb: 1.5 }}>
          <Conclusion explanation={explanation} action={action} />
          {item.details.length > 0 && (
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5, py: 0.5 }}>
              {item.details.map(detail => (detail.type === 'guest'
                ? <GuestLine key={detail.id} guest={detail} onOpenVm={onOpenVm} />
                : <NodeLine key={detail.key} node={detail} />))}
            </Box>
          )}
        </Stack>
      </Collapse>
    </Box>
  )
}

export default function OptimizationPlanCard({ plan, loading, failed, onRegenerate, onOpenVm }: {
  plan: OptimizationPlan | null
  loading: boolean
  failed: boolean
  onRegenerate: () => void
  onOpenVm: (vm: VmIdentity) => void
}) {
  const t = useTranslations()
  let summary = plan?.summary ?? ''
  if (plan?.provider === 'basic' && plan.summaryKey) {
    const params = plan.summaryParams ? { ...plan.summaryParams, ram: `${plan.summaryParams.ram} GB` } : {}

    summary = t(`resources.optimization.${plan.summaryKey}`, params)
  }

  return (
    <AiReadingCard
      icon="ri-sparkling-line"
      title={t('resources.optimization.title')}
      idleSubtitle={t('resources.optimization.subtitle')}
      pendingTitle={t('resources.optimization.pendingTitle')}
      pendingHint={t('resources.optimization.pendingHint')}
      reading={plan}
      summary={summary}
      loading={loading}
      failed={failed}
      onRegenerate={onRegenerate}
    >
      {plan && (plan.items.length === 0 ? (
        <EmptyState icon="ri-checkbox-circle-line" text={t('resources.optimization.nothing')} />
      ) : (
        <PagedRows items={plan.items}>
          {item => <PlanRow key={item.ref} item={item} onOpenVm={onOpenVm} />}
        </PagedRows>
      ))}
    </AiReadingCard>
  )
}
