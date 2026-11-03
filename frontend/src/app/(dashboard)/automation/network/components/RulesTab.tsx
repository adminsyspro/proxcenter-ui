'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'

import { Box, Button, Chip, ToggleButton, ToggleButtonGroup, Tooltip, useTheme, alpha } from '@mui/material'

import * as firewallAPI from '@/lib/api/firewall'
import { VMFirewallInfo } from '@/hooks/useVMFirewallRules'

import FirewallLoadAlert from './FirewallLoadAlert'
import FirewallPolicyTable from './rules/FirewallPolicyTable'
import HostRulesPanel from './rules/HostRulesPanel'
import VMRulesPanel from './rules/VMRulesPanel'

interface RulesTabProps {
  activeSubTab: number
  onSubTabChange: (newTab: number) => void
  /** Firewalling > VMs opened from the Dashboard's "To do" list: only the guests without firewall, until cleared. */
  guestFilter?: 'unprotected' | null
  onClearGuestFilter?: () => void
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
  loadVMFirewallData: (force?: boolean) => Promise<void>
  loadGuestRules: (vm: VMFirewallInfo) => Promise<firewallAPI.FirewallRule[]>
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
  /** What failed on the last load of the firewall data, null when it all loaded. */
  loadError?: string | null
  reload: () => void
}

/**
 * Map legacy sub-tab indices (still passed by the Dashboard's links and older callers) to new ones:
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
  activeSubTab, onSubTabChange, guestFilter, onClearGuestFilter,
  clusterRules, setClusterRules,
  clusterOptions, setClusterOptions,
  hostRulesByNode, nodesList, loadingHostRules, loadHostRules, reloadHostRulesForNode,
  vmFirewallData, loadingVMRules, loadVMFirewallData, loadGuestRules, reloadVMFirewallRules,
  securityGroups, aliases, ipsets, firewallMode, totalRules,
  selectedConnection, loadError, reload
}: RulesTabProps) {
  const theme = useTheme()
  const t = useTranslations()

  const hostRulesCount = Object.values(hostRulesByNode).reduce((acc, r) => acc + r.length, 0)
  // The guests' rules are read one guest at a time, when its row is opened (UA44): the VM count is the number of
  // guests listed, not a rule total that would only add up the rows opened so far.
  const vmGuestCount = vmFirewallData.length
  const policyRulesCount = clusterRules.length
  // Certainly not filtered by Proxmox: a guest whose state is unknown is not listed as one.
  const shownGuests = guestFilter === 'unprotected' ? vmFirewallData.filter(vm => !vm.firewallEnabled && !vm.stateUnknown) : vmFirewallData

  // Remap legacy sub-tab values on mount / when changed from outside
  useEffect(() => {
    if (activeSubTab > 2) {
      onSubTabChange(mapLegacySubTab(activeSubTab))
    }
  }, [activeSubTab, onSubTabChange])

  const currentTab = activeSubTab > 2 ? mapLegacySubTab(activeSubTab) : activeSubTab

  return (
    <Box sx={{ p: 3 }}>
      <FirewallLoadAlert error={loadError} onRetry={reload} />
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
              borderColor: alpha(theme.palette.divider, 0.3),
              '&.Mui-selected': {
                bgcolor: alpha(theme.palette.primary.main, 0.15),
                color: theme.palette.primary.main,
                borderColor: alpha(theme.palette.primary.main, 0.4),
              }
            }
          }}
        >
          <ToggleButton value={0}>
            <i className="ri-server-line" style={{ marginRight: 6, fontSize: 16 }} />
            {t('networkPage.clusterFirewall')}
            <Chip label={policyRulesCount} size="small" sx={{ ml: 1, height: 18, minWidth: 18, fontSize: 10, fontWeight: 700 }} />
          </ToggleButton>
          <ToggleButton value={1}>
            <img
              src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'}
              alt=""
              width={16}
              height={16}
              style={{ marginRight: 6, opacity: 0.8 }}
            />
            {t('networkPage.hostRules')}
            <Chip label={hostRulesCount} size="small" sx={{ ml: 1, height: 18, minWidth: 18, fontSize: 10, fontWeight: 700 }} />
          </ToggleButton>
          <ToggleButton value={2}>
            <i className="ri-computer-line" style={{ marginRight: 6, fontSize: 16 }} />
            {t('networkPage.vmDirectRules')}
            {vmGuestCount > 0 && (
              <Tooltip title={t('networkPage.rulesOnDemand.vmTabCount')}>
                <Chip label={vmGuestCount} size="small" sx={{ ml: 1, height: 18, minWidth: 18, fontSize: 10, fontWeight: 700 }} />
              </Tooltip>
            )}
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {currentTab === 0 && (
        <FirewallPolicyTable
          clusterRules={clusterRules}
          securityGroups={securityGroups}
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
        <>
        {guestFilter === 'unprotected' && (
          <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Chip
              data-testid='guest-filter'
              color='warning'
              variant='outlined'
              icon={<i className='ri-filter-3-line' style={{ fontSize: 14 }} />}
              label={t('networkPage.dashboard.filterUnprotected', { count: shownGuests.length })}
            />
            <Button size='small' onClick={onClearGuestFilter}>{t('networkPage.dashboard.filterClear')}</Button>
          </Box>
        )}
        <VMRulesPanel
          vmFirewallData={shownGuests}
          listFilter={guestFilter ?? null}
          securityGroups={securityGroups}
          loadingVMRules={loadingVMRules}
          selectedConnection={selectedConnection}
          loadVMFirewallData={loadVMFirewallData}
          loadGuestRules={loadGuestRules}
          reloadVMFirewallRules={reloadVMFirewallRules}
          aliases={aliases}
          ipsets={ipsets}
        />
        </>
      )}
    </Box>
  )
}
