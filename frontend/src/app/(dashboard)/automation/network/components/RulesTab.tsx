'use client'

import { Box, ToggleButton, ToggleButtonGroup, Badge, useTheme, alpha } from '@mui/material'

import * as firewallAPI from '@/lib/api/firewall'
import { VMFirewallInfo } from '@/hooks/useVMFirewallRules'

import ClusterRulesPanel from './rules/ClusterRulesPanel'
import HostRulesPanel from './rules/HostRulesPanel'
import VMRulesPanel from './rules/VMRulesPanel'
import SecurityGroupsPanel from './rules/SecurityGroupsPanel'

interface RulesTabProps {
  activeSubTab: number
  onSubTabChange: (newTab: number) => void
  // Cluster
  clusterRules: firewallAPI.FirewallRule[]
  setClusterRules: React.Dispatch<React.SetStateAction<firewallAPI.FirewallRule[]>>
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
  firewallMode: firewallAPI.FirewallMode
  totalRules: number
  // Common
  selectedConnection: string
  reload: () => void
}

export default function RulesTab({
  activeSubTab, onSubTabChange,
  clusterRules, setClusterRules,
  hostRulesByNode, nodesList, loadingHostRules, loadHostRules, reloadHostRulesForNode,
  vmFirewallData, loadingVMRules, loadVMFirewallData, reloadVMFirewallRules,
  securityGroups, firewallMode, totalRules,
  selectedConnection, reload
}: RulesTabProps) {
  const theme = useTheme()

  const hostRulesCount = Object.values(hostRulesByNode).reduce((acc, r) => acc + r.length, 0)
  const vmRulesCount = vmFirewallData.reduce((acc, v) => acc + v.rules.length, 0)

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'center' }}>
        <ToggleButtonGroup
          value={activeSubTab}
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
          <ToggleButton value={0} disabled={firewallMode === 'standalone'}>
            <i className="ri-cloud-line" style={{ marginRight: 6, fontSize: 16 }} />
            Cluster
            <Badge badgeContent={clusterRules.length} color="primary" sx={{ ml: 1.5, '& .MuiBadge-badge': { fontSize: 10, height: 16, minWidth: 16 } }} />
          </ToggleButton>
          <ToggleButton value={1}>
            <i className="ri-server-line" style={{ marginRight: 6, fontSize: 16 }} />
            Nodes
            <Badge badgeContent={hostRulesCount} color="primary" sx={{ ml: 1.5, '& .MuiBadge-badge': { fontSize: 10, height: 16, minWidth: 16 } }} />
          </ToggleButton>
          <ToggleButton value={2}>
            <i className="ri-computer-line" style={{ marginRight: 6, fontSize: 16 }} />
            VMs
            <Badge badgeContent={vmRulesCount} color="primary" sx={{ ml: 1.5, '& .MuiBadge-badge': { fontSize: 10, height: 16, minWidth: 16 } }} />
          </ToggleButton>
          <ToggleButton value={3}>
            <i className="ri-shield-line" style={{ marginRight: 6, fontSize: 16 }} />
            Security Groups
            <Badge badgeContent={securityGroups.length} color="primary" sx={{ ml: 1.5, '& .MuiBadge-badge': { fontSize: 10, height: 16, minWidth: 16 } }} />
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {activeSubTab === 0 && (
        <ClusterRulesPanel
          clusterRules={clusterRules}
          securityGroups={securityGroups}
          selectedConnection={selectedConnection}
          setClusterRules={setClusterRules}
        />
      )}
      {activeSubTab === 1 && (
        <HostRulesPanel
          hostRulesByNode={hostRulesByNode}
          nodesList={nodesList}
          securityGroups={securityGroups}
          loadingHostRules={loadingHostRules}
          selectedConnection={selectedConnection}
          loadHostRules={loadHostRules}
          reloadHostRulesForNode={reloadHostRulesForNode}
        />
      )}
      {activeSubTab === 2 && (
        <VMRulesPanel
          vmFirewallData={vmFirewallData}
          loadingVMRules={loadingVMRules}
          selectedConnection={selectedConnection}
          loadVMFirewallData={loadVMFirewallData}
          reloadVMFirewallRules={reloadVMFirewallRules}
        />
      )}
      {activeSubTab === 3 && (
        <SecurityGroupsPanel
          securityGroups={securityGroups}
          firewallMode={firewallMode}
          selectedConnection={selectedConnection}
          totalRules={totalRules}
          reload={reload}
        />
      )}
    </Box>
  )
}
