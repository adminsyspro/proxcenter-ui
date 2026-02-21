'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'

import { Box, Chip, ToggleButton, ToggleButtonGroup, useTheme, alpha } from '@mui/material'

import * as firewallAPI from '@/lib/api/firewall'
import { VMFirewallInfo } from '@/hooks/useVMFirewallRules'

import FirewallPolicyTable from './rules/FirewallPolicyTable'
import HostRulesPanel from './rules/HostRulesPanel'
import VMRulesPanel from './rules/VMRulesPanel'

interface RulesTabProps {
  activeSubTab: number
  onSubTabChange: (newTab: number) => void
  // Cluster
  clusterRules: firewallAPI.FirewallRule[]
  setClusterRules: React.Dispatch<React.SetStateAction<firewallAPI.FirewallRule[]>>
  clusterOptions: firewallAPI.ClusterOptions | null
  setClusterOptions: React.Dispatch<React.SetStateAction<firewallAPI.ClusterOptions | null>>
  // Host
  hostRulesByNode: Record<string, firewallAPI.FirewallRule[]>
  nodesList: string[]
  loadingHostRules: boolean
  loadHostRules: () => Promise<void>
  reloadHostRulesForNode: (node: string) => Promise<void>
  // VM
  vmFirewallData: VMFirewallInfo[]
  loadingVMRules: boolean
  loadVMFirewallData: () => Promise<void>
  reloadVMFirewallRules: (vm: VMFirewallInfo) => Promise<void>
  // Security Groups
  securityGroups: firewallAPI.SecurityGroup[]
  // Aliases + IPSets
  aliases: firewallAPI.Alias[]
  ipsets: firewallAPI.IPSet[]
  firewallMode: firewallAPI.FirewallMode
  totalRules: number
  // Common
  selectedConnection: string
  reload: () => void
}

/**
 * Map legacy sub-tab indices (used by StatCards / DashboardTab) to new ones:
 *   Old 0 (Cluster) / 3 (SGs) → New 0 (Cluster Firewall)
 *   Old 1 (Nodes)              → New 1 (Host Rules)
 *   Old 2 (VMs)                → New 2 (VM Rules)
 */
function mapLegacySubTab(v: number): number {
  if (v === 0 || v === 3) return 0
  if (v === 1) return 1
  if (v === 2) return 2
  return 0
}

export default function RulesTab({
  activeSubTab, onSubTabChange,
  clusterRules, setClusterRules,
  clusterOptions, setClusterOptions,
  hostRulesByNode, nodesList, loadingHostRules, loadHostRules, reloadHostRulesForNode,
  vmFirewallData, loadingVMRules, loadVMFirewallData, reloadVMFirewallRules,
  securityGroups, aliases, ipsets, firewallMode, totalRules,
  selectedConnection, reload
}: RulesTabProps) {
  const theme = useTheme()
  const t = useTranslations()

  const hostRulesCount = Object.values(hostRulesByNode).reduce((acc, r) => acc + r.length, 0)
  const vmRulesCount = vmFirewallData.reduce((acc, v) => acc + v.rules.length, 0)
  const policyRulesCount = clusterRules.length + securityGroups.reduce((acc, g) => acc + (g.rules?.length || 0), 0)

  // Remap legacy sub-tab values on mount / when changed from outside
  useEffect(() => {
    if (activeSubTab > 2) {
      onSubTabChange(mapLegacySubTab(activeSubTab))
    }
  }, [activeSubTab, onSubTabChange])

  const currentTab = activeSubTab > 2 ? mapLegacySubTab(activeSubTab) : activeSubTab

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'center' }}>
        <ToggleButtonGroup
          value={currentTab}
          exclusive
          onChange={(_, v) => { if (v !== null) onSubTabChange(v) }}
          size="small"
          sx={{
            '& .MuiToggleButton-root': {
              textTransform: 'none',
              fontWeight: 600,
              fontSize: 13,
              px: 2.5,
              py: 0.8,
              borderColor: alpha(theme.palette.divider, 0.2),
              '&.Mui-selected': {
                bgcolor: alpha(theme.palette.primary.main, 0.1),
                color: theme.palette.primary.main,
                borderColor: alpha(theme.palette.primary.main, 0.3),
              }
            }
          }}
        >
          <ToggleButton value={0}>
            <i className="ri-shield-flash-line" style={{ marginRight: 6, fontSize: 16 }} />
            {t('networkPage.clusterFirewall')}
            <Chip label={policyRulesCount} size="small" sx={{ ml: 1, height: 18, minWidth: 18, fontSize: 10, fontWeight: 700 }} />
          </ToggleButton>
          <ToggleButton value={1}>
            <i className="ri-server-line" style={{ marginRight: 6, fontSize: 16 }} />
            {t('networkPage.hostRules')}
            <Chip label={hostRulesCount} size="small" sx={{ ml: 1, height: 18, minWidth: 18, fontSize: 10, fontWeight: 700 }} />
          </ToggleButton>
          <ToggleButton value={2}>
            <i className="ri-computer-line" style={{ marginRight: 6, fontSize: 16 }} />
            {t('networkPage.vmDirectRules')}
            <Chip label={vmRulesCount} size="small" sx={{ ml: 1, height: 18, minWidth: 18, fontSize: 10, fontWeight: 700 }} />
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {currentTab === 0 && (
        <FirewallPolicyTable
          clusterRules={clusterRules}
          securityGroups={securityGroups}
          vmFirewallData={vmFirewallData}
          firewallMode={firewallMode}
          selectedConnection={selectedConnection}
          setClusterRules={setClusterRules}
          clusterOptions={clusterOptions}
          setClusterOptions={setClusterOptions}
          aliases={aliases}
          ipsets={ipsets}
          reload={reload}
        />
      )}
      {currentTab === 1 && (
        <HostRulesPanel
          hostRulesByNode={hostRulesByNode}
          nodesList={nodesList}
          securityGroups={securityGroups}
          loadingHostRules={loadingHostRules}
          selectedConnection={selectedConnection}
          loadHostRules={loadHostRules}
          reloadHostRulesForNode={reloadHostRulesForNode}
          aliases={aliases}
          ipsets={ipsets}
        />
      )}
      {currentTab === 2 && (
        <VMRulesPanel
          vmFirewallData={vmFirewallData}
          loadingVMRules={loadingVMRules}
          selectedConnection={selectedConnection}
          loadVMFirewallData={loadVMFirewallData}
          reloadVMFirewallRules={reloadVMFirewallRules}
          aliases={aliases}
          ipsets={ipsets}
        />
      )}
    </Box>
  )
}
