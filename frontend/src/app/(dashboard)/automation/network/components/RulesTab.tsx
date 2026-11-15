'use client'

import { useTranslations } from 'next-intl'

import { Box, Button, Chip } from '@mui/material'

import * as firewallAPI from '@/lib/api/firewall'
import { VMFirewallInfo } from '@/hooks/useVMFirewallRules'

import FirewallLoadAlert from './FirewallLoadAlert'
import FirewallingView from './rules/FirewallingView'
import { scopeOfSubTab } from './rules/dfwModel'

interface RulesTabProps {
  /** The scope the table opens on, from the Dashboard's links: 0 everything, 1 the hosts, 2 the VMs. */
  activeSubTab: number
  onSubTabChange: (newTab: number) => void
  /** Firewalling opened from the Dashboard's "To do" list: only the guests without firewall, until cleared. */
  guestFilter?: 'unprotected' | null
  onClearGuestFilter?: () => void
  clusterRules: firewallAPI.FirewallRule[]
  setClusterRules: React.Dispatch<React.SetStateAction<firewallAPI.FirewallRule[]>>
  clusterOptions: firewallAPI.ClusterOptions | null
  setClusterOptions: React.Dispatch<React.SetStateAction<firewallAPI.ClusterOptions | null>>
  hostRulesByNode: Record<string, firewallAPI.FirewallRule[]>
  setHostRulesByNode: React.Dispatch<React.SetStateAction<Record<string, firewallAPI.FirewallRule[]>>>
  nodesList: string[]
  nodeStatus?: Record<string, string>
  vmFirewallData: VMFirewallInfo[]
  setVMFirewallData: React.Dispatch<React.SetStateAction<VMFirewallInfo[]>>
  loadingVMRules: boolean
  loadVMFirewallData: (force?: boolean) => Promise<void>
  loadGuestRules: (vm: VMFirewallInfo) => Promise<firewallAPI.FirewallRule[]>
  securityGroups: firewallAPI.SecurityGroup[]
  aliases: firewallAPI.Alias[]
  ipsets: firewallAPI.IPSet[]
  firewallMode: firewallAPI.FirewallMode
  selectedConnection: string
  connectionName?: string
  /** What failed on the last load of the firewall data, null when it all loaded. */
  loadError?: string | null
  reload: () => void
}

/**
 * Firewalling (UA51): one table of every rule list of the connection, sections per scope (the micro-segmentation
 * zone groups, read-only, the cluster, each host, each guest by VLAN), edited in a draft and published in one call.
 */
export default function RulesTab({
  activeSubTab, guestFilter, onClearGuestFilter,
  clusterRules, setClusterRules, clusterOptions, setClusterOptions,
  hostRulesByNode, setHostRulesByNode, nodesList, nodeStatus,
  vmFirewallData, setVMFirewallData, loadingVMRules, loadVMFirewallData, loadGuestRules,
  securityGroups, aliases, ipsets, firewallMode, selectedConnection, connectionName, loadError, reload,
}: RulesTabProps) {
  const t = useTranslations()
  // Certainly not filtered by Proxmox: a guest whose state is unknown is not listed as one.
  const shownGuests = guestFilter === 'unprotected' ? vmFirewallData.filter(vm => !vm.firewallEnabled && !vm.stateUnknown) : vmFirewallData
  const initialScope = guestFilter ? 'vms' : scopeOfSubTab(activeSubTab, firewallMode === 'standalone')

  return (
    <Box sx={{ p: 3 }}>
      <FirewallLoadAlert error={loadError} onRetry={reload} />
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
      {selectedConnection && (
        <FirewallingView
          key={`${selectedConnection}|${initialScope}`}
          connectionId={selectedConnection}
          connectionName={connectionName}
          firewallMode={firewallMode}
          nodesList={nodesList}
          nodeStatus={nodeStatus}
          clusterRules={clusterRules}
          setClusterRules={setClusterRules}
          clusterOptions={clusterOptions}
          setClusterOptions={setClusterOptions}
          hostRulesByNode={hostRulesByNode}
          setHostRulesByNode={setHostRulesByNode}
          guests={shownGuests}
          setVMFirewallData={setVMFirewallData}
          loadingVMRules={loadingVMRules}
          loadGuestRules={loadGuestRules}
          securityGroups={securityGroups}
          aliases={aliases}
          ipsets={ipsets}
          initialScope={initialScope}
          listFilter={guestFilter ?? null}
          reloadFirewall={reload}
          reloadGuests={() => loadVMFirewallData(true)}
        />
      )}
    </Box>
  )
}
