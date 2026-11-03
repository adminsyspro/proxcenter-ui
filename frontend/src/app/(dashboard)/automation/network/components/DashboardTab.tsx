'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Box } from '@mui/material'

import * as firewallAPI from '@/lib/api/firewall'
import { useVMFirewallCoverage } from '@/hooks/useZeroTrust'
import { PVE_DEFAULT_POLICY_IN, PVE_DEFAULT_POLICY_OUT } from '@/lib/firewall/pveDefaults'
import { useMicrosegPolicy } from '@/lib/microseg/useMicroseg'
import { useMicrosegDrifts, useMicrosegSuggestions } from '@/lib/microseg/useMicrosegLists'
import { useMicrosegStatus } from '@/lib/microseg/useMicrosegStatus'

import ClusterFirewallCard from './ClusterFirewallCard'
import DashboardCoverage from './DashboardCoverage'
import DashboardTodo, { type TodoActions } from './DashboardTodo'
import { dashboardPhase, missingManagementPorts, todoItems, zeroTrustScore } from './dashboardModel'
import DeploymentWizard from './DeploymentWizard'
import FirewallLoadAlert from './FirewallLoadAlert'
import ZeroTrustScoreCard from './ZeroTrustScoreCard'
import { coverage as microsegCoverage } from './microseg/coverage'
import MicrosegSummaryCard from './microseg/MicrosegSummaryCard'
import type { MicrosegSubTab } from './microseg/microsegTabTypes'
import { clusterFirewallOff, unzonedRunning } from './microseg/summaryModel'

/** The guest filter Firewalling > VMs opens with from the "To do" list. */
export type GuestFilter = 'unprotected'

interface DashboardTabProps {
  // Data
  securityGroups: firewallAPI.SecurityGroup[]
  clusterOptions: firewallAPI.ClusterOptions | null
  clusterRules: firewallAPI.FirewallRule[]
  aliases: firewallAPI.Alias[]
  ipsets: firewallAPI.IPSet[]
  firewallMode: firewallAPI.FirewallMode
  currentOptions: firewallAPI.ClusterOptions | firewallAPI.NodeOptions | null
  selectedConnection: string
  /** Name of the selected connection, shown on the micro-segmentation card. */
  connectionName?: string
  totalRules: number
  totalIPSetEntries: number
  nodesList: string[]
  /** What failed on the last load of the firewall data, null when it all loaded. */
  loadError?: string | null
  /** The firewall data is still loading: nothing can be said about the cluster yet. */
  loading?: boolean
  // Handlers
  reload: () => void
  // Navigation
  onNavigateTab: (tab: number) => void
  onNavigateRulesSubTab: (subTab: number) => void
  /** Firewalling > VMs, filtered on the guests without firewall when asked. */
  onOpenGuests?: (filter?: GuestFilter) => void
  /** The Micro-segmentation tab, on one of its sub-tabs when asked. */
  onOpenMicroseg?: (subTab?: MicrosegSubTab) => void
}

/** Pending observed flows read for the count: past it, the line says "more than". */
export const PENDING_FLOWS_LIMIT = 100

/** A read is settled once it answered or failed. */
const settled = (read: { data?: unknown; error?: unknown }) => !!read.data || !!read.error

/** The count of the pending flows read (one more than the limit was asked: past it, "more than"). */
function pendingFlowsOf(list: unknown[] | undefined): { count: number; more: boolean } | null {
  if (!list) return null

  return { count: Math.min(list.length, PENDING_FLOWS_LIMIT), more: list.length > PENDING_FLOWS_LIMIT }
}

/** What each score component reads, null while it is not known. */
function scoreValuesOf(clusterKnown: boolean, firewallOn: boolean, policyIn: string, percent: number | null, t: ReturnType<typeof useTranslations>) {
  const firewallWord = firewallOn ? t('firewallOn') : t('firewallOff')

  return {
    firewall: clusterKnown ? firewallWord : null,
    policyIn: clusterKnown ? policyIn : null,
    coverage: percent === null ? null : `${Math.round(percent)}%`,
  }
}

/**
 * The Dashboard of /automation/network (UA46): three state cards with one source for their figures (cluster firewall,
 * micro-segmentation, guest firewall coverage), the Zero Trust score computed on those figures, and the "To do" list.
 * Its reads: the firewall data the page loads, the coverage route (computed and cached on the server), the
 * micro-segmentation status, policy, drifts and pending flows (orchestrator memory, no Proxmox call).
 */
export default function DashboardTab({
  firewallMode, currentOptions,
  selectedConnection, connectionName, clusterOptions, clusterRules, nodesList,
  securityGroups, loadError, loading = false,
  reload, onNavigateTab, onNavigateRulesSubTab, onOpenGuests, onOpenMicroseg,
}: DashboardTabProps) {
  const t = useTranslations('networkPage.dashboard')
  const [deployWizardOpen, setDeployWizardOpen] = useState(false)
  const connection = selectedConnection || null

  // Read once when the tab shows (this component mounts with it), computed and cached on the server (UA44).
  const coverageRead = useVMFirewallCoverage(connection)
  const coverage = coverageRead.data?.computedAt ? coverageRead.data : null
  // The same reads as the micro-segmentation card (SWR shares them): the emergency stop may hold the firewall off.
  const microsegStatus = useMicrosegStatus(connection)
  const microsegPolicy = useMicrosegPolicy(connection)
  const drifts = useMicrosegDrifts(connection)
  const pending = useMicrosegSuggestions(connection, { status: 'pending', limit: PENDING_FLOWS_LIMIT + 1 })

  // Node options carry no policy: a host follows the cluster's, and an unset policy is PVE's default, not ACCEPT (#1065).
  const policyIn = clusterOptions?.policy_in || PVE_DEFAULT_POLICY_IN
  const policyOut = clusterOptions?.policy_out || PVE_DEFAULT_POLICY_OUT
  const firewallOn = currentOptions?.enable === 1

  const status = microsegStatus.data
  const policy = microsegPolicy.data
  const stopped = status?.emergency_stop ?? policy?.policy.emergency_stop ?? false
  const stopHoldsFirewall = stopped && clusterFirewallOff(status, policy)

  const phase = dashboardPhase({
    firewallLoading: loading,
    loadError: !!loadError,
    coverageIn: !!coverage,
    coverageFailed: !coverage && !!coverageRead.error,
    stopStateIn: settled(microsegStatus) && settled(microsegPolicy),
    microsegListsIn: settled(drifts) && settled(pending),
  })

  const clusterKnown = phase.cluster === 'ready'
  const score = zeroTrustScore({
    firewallOn: clusterKnown ? firewallOn : null,
    policyIn: clusterKnown ? policyIn : null,
    coverage,
  })
  const scoreValues = scoreValuesOf(clusterKnown, firewallOn, policyIn, score.coveragePercent, t)
  const items = todoItems({
    firewallOn,
    stopped,
    stopHoldsFirewall,
    policyIn,
    missingManagement: missingManagementPorts(clusterRules, securityGroups),
    unprotected: coverage ? coverage.disabled : null,
    unzoned: unzonedRunning(status ? microsegCoverage(status) : null, drifts.data),
    pendingFlows: pendingFlowsOf(pending.data),
  })

  const openRules = (subTab: number) => () => { onNavigateTab(1); onNavigateRulesSubTab(subTab) }
  const openGuests = (filter?: GuestFilter) => {
    if (onOpenGuests) onOpenGuests(filter)
    else openRules(2)()
  }
  const openMicroseg = (subTab?: MicrosegSubTab) => {
    if (onOpenMicroseg) onOpenMicroseg(subTab)
    else onNavigateTab(6)
  }
  const actions: TodoActions = {
    stopHeld: () => openMicroseg('overview'),
    firewallOff: () => setDeployWizardOpen(true),
    managementRules: () => setDeployWizardOpen(true),
    policyIn: openRules(0),
    unprotected: () => openGuests('unprotected'),
    unzoned: () => openMicroseg('drifts'),
    pendingFlows: () => openMicroseg('observation'),
  }

  if (!selectedConnection) return <Box sx={{ p: 3 }} />

  return (
    <Box sx={{ p: 3 }}>
      <FirewallLoadAlert error={loadError} onRetry={reload} />

      <DeploymentWizard
        open={deployWizardOpen}
        onClose={() => setDeployWizardOpen(false)}
        selectedConnection={selectedConnection}
        clusterOptions={clusterOptions}
        clusterRules={clusterRules}
        nodesList={nodesList}
        firewallMode={firewallMode}
        onComplete={reload}
      />

      {/* 1. Three state cards, one row */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(3, minmax(0, 1fr))' }, gap: 2, mb: 3 }}>
        <ClusterFirewallCard
          phase={phase.cluster}
          firewallMode={firewallMode}
          firewallOn={firewallOn}
          stopHoldsFirewall={stopHoldsFirewall}
          policyIn={policyIn}
          policyOut={policyOut}
          rules={clusterRules.length}
          groups={securityGroups.length}
          onOpen={openRules(0)}
        />
        <MicrosegSummaryCard key={selectedConnection} connectionId={selectedConnection} connectionName={connectionName} onOpen={() => openMicroseg()} />
        <DashboardCoverage
          coverage={coverage}
          error={coverageRead.error}
          refreshing={coverageRead.refreshing}
          onRefresh={() => { void coverageRead.refresh() }}
          onOpen={() => openGuests()}
        />
      </Box>

      {/* 2. Zero Trust score, on the figures above */}
      <ZeroTrustScoreCard phase={phase.score} score={score} values={scoreValues} />

      {/* 3. To do */}
      <DashboardTodo phase={phase.todo} items={items} actions={actions} />
    </Box>
  )
}
