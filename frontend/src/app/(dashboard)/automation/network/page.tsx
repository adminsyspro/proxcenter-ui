'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'

import {
  Alert, Box, Card, FormControl, IconButton, InputLabel, MenuItem,
  Select, Tab, Tabs, useTheme, alpha
} from '@mui/material'

import { usePageTitle } from "@/contexts/PageTitleContext"
import EnterpriseGuard from '@/components/guards/EnterpriseGuard'
import ProviderTenantGuard from '@/components/guards/ProviderTenantGuard'
import { Features, useLicense } from '@/contexts/LicenseContext'
import { usePVEConnections } from '@/hooks/useConnections'
import { useSWRFetch } from '@/hooks/useSWRFetch'
import { useFirewallData, Connection } from '@/hooks/useFirewallData'
import { useVMFirewallRules } from '@/hooks/useVMFirewallRules'
import { useGroupUsage } from '@/hooks/useGroupUsage'
import { useHostFirewallRules } from '@/hooks/useHostFirewallRules'

import DashboardTab, { type GuestFilter } from './components/DashboardTab'
import type { MicrosegSubTab, ObservationFocus } from './components/microseg/microsegTabTypes'
import RulesTab from './components/RulesTab'
import ObjectsTab from './components/ObjectsTab'
import SecurityGroupsPanel from './components/rules/SecurityGroupsPanel'
import LoggingTab from './components/LoggingTab'
import MicrosegTab from './components/microseg/MicrosegTab'
import ClusterGroupProbe from './components/microseg/ClusterGroupProbe'
import { entryOf, selectionAfterDissociation, selectorEntries, sharedConnections, visible } from './components/microseg/clusterModel'
import { ConnectionKindsContext, ConnectionsLabel, useConnectionKinds } from './components/microseg/ConnectionGlyph'
import { MicrosegWriteContext, useCanManageMicroseg } from './components/microseg/microsegAccess'
import { connectionOfVm, parseNetworkLink, pickConnection, readStoredConnection, storeConnection, TAB } from './networkLink'

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN PAGE, 7 tabs: Dashboard, Micro-segmentation, Firewalling, Logging, Security Groups, IP Sets, Aliases
   (order = NETWORK_TABS; each Tab carries its index). The sFlow volumes are in the Dashboard and the map, the agents in
   Settings > sFlow
═══════════════════════════════════════════════════════════════════════════ */


const TAB_SX = { textTransform: 'none', fontWeight: 600, fontSize: 14 } as const

export default function NetworkAutomationPage() {
  const theme = useTheme()
  const { setPageInfo } = usePageTitle()
  const t = useTranslations()
  const { isEnterprise } = useLicense()

  // ── State ──
  // A link (?tab, ?sub, ?connection, ?vm) decides the tab, the sub-tab and the connection the page opens on; read once.
  const params = useSearchParams()
  const [link] = useState(() => parseNetworkLink(params))
  const [activeTab, setActiveTab] = useState(link.tab ?? 0)
  const [rulesSubTab, setRulesSubTab] = useState(0)
  // The connection picked in the selector; until then the link's, the one remembered in the browser, or the first.
  const [pickedConnection, setPickedConnection] = useState('')
  const [storedConnection] = useState(readStoredConnection)
  // Set by a line of the Dashboard's "To do" list, for the tab it opens; dropped on any other tab change.
  const [guestFilter, setGuestFilter] = useState<GuestFilter | null>(null)
  const [microsegSubTab, setMicrosegSubTab] = useState<MicrosegSubTab | null>(link.sub)
  const [observationFocus, setObservationFocus] = useState<ObservationFocus | null>(null)
  const changeTab = (tab: number) => {
    setActiveTab(tab)
    setGuestFilter(null)
    setMicrosegSubTab(null)
    setObservationFocus(null)
  }

  // ── Connections ──
  const { data: connectionsData } = usePVEConnections()
  const connections: Connection[] = useMemo(() => (isEnterprise ? (connectionsData?.data || []) : []), [isEnterprise, connectionsData])

  // A ?vm= link without ?connection=: the connection holding that guest, from the inventory the app keeps cached
  // server side (no Proxmox call when it is warm). Nothing is selected while it is read, so no other connection's
  // data is computed meanwhile; a refusal or a guest found nowhere falls back to the usual choice.
  const vmLookup = isEnterprise && link.vm !== null && !link.connection && !pickedConnection
  const { data: inventory, error: inventoryError } = useSWRFetch(vmLookup ? '/api/v1/inventory' : null, { revalidateOnFocus: false, dedupingInterval: 60000 })
  const vmConnection = vmLookup && inventory && link.vm !== null ? connectionOfVm(inventory, link.vm) : null
  const waitingForVm = vmLookup && !inventory && !inventoryError
  const selectedConnection = pickedConnection
    || (waitingForVm ? '' : pickConnection(connections, [link.connection, vmConnection, storedConnection]))
  // The live ?vm= (the Overview drops it from the address once the admin picks or clears a target).
  const linkedVm = params?.get('vm') ?? null

  // ── Groups of connections sharing one micro-segmentation policy ──
  // On the Dashboard and Micro-segmentation tabs (both show the whole policy), the clusters of one group are one entry
  // of the selector, valued with the group's anchor: the same entry stays selected from one of them to the other. Each
  // connection's group is read once (a page with a single connection reads none); the other tabs keep the plain list.
  const [groups, setGroups] = useState<Record<string, string[]>>({})
  const reportGroup = useCallback((id: string, ids: string[]) => {
    setGroups(prev => (prev[id]?.join() === ids.join() ? prev : { ...prev, [id]: ids }))
  }, [])
  const groupsShown = (activeTab === TAB.microseg || activeTab === TAB.dashboard) && connections.length > 1
  const selectorItems = useMemo(
    () => (groupsShown ? selectorEntries(connections, groups) : connections.map(c => ({ value: c.id, label: c.name, ids: [c.id] }))),
    [groupsShown, connections, groups],
  )
  const selectorValue = (selectedConnection && entryOf(selectorItems, selectedConnection)?.value) || selectedConnection
  // The connection the page is on left its group: stay on the group (a cluster that remains), not on its own new policy.
  const followGroup = useCallback((left: string, remaining: string[]) => {
    const next = selectionAfterDissociation(selectedConnection, left, remaining, connections)
    if (next !== selectedConnection) setPickedConnection(next)
  }, [selectedConnection, connections])
  const groupedConnections = useMemo(() => sharedConnections(groups), [groups])
  // Cluster or standalone node, and its state, for the glyphs of the selector and of the cluster chips: read once.
  const connectionIds = useMemo(() => connections.map(c => c.id), [connections])
  const connectionKinds = useConnectionKinds(connectionIds, true)

  // ── Data hooks ──
  const {
    aliases, ipsets, securityGroups, clusterOptions, clusterRules,
    nodeOptions, firewallMode, nodesList, nodeStatus,
    loading, loadError, reload: loadFirewallData, setClusterRules, setClusterOptions,
  } = useFirewallData(isEnterprise ? selectedConnection || null : null, isEnterprise)

  const {
    vmFirewallData, loadingVMRules, vmRulesError, guestsNotScanned, loadVMFirewallData, loadGuestRules, reloadVMFirewallRules, setVMFirewallData,
  } = useVMFirewallRules(isEnterprise ? selectedConnection || null : null)
  const enterpriseConnection = isEnterprise ? selectedConnection || null : null

  // Which guests carry which security group: read by the server (bounded there), only once this tab is shown.
  const {
    usage: groupUsage, loading: groupUsageLoading, reload: reloadGroupUsage, check: checkGroupUsage,
  } = useGroupUsage(enterpriseConnection, activeTab === TAB.groups)

  const {
    hostRulesByNode, hostRulesError, setHostRulesByNode,
  } = useHostFirewallRules(enterpriseConnection, nodesList)

  // The firewall tabs write with node.manage on the connection, like the micro-segmentation: a read-only user sees
  // every write control of Firewalling, Aliases, IP Sets and Security Groups disabled, with the reason (WriteTip).
  const canWriteFirewall = useCanManageMicroseg(selectedConnection)

  // ── Derived values ──
  const currentOptions = firewallMode === 'cluster' ? clusterOptions : nodeOptions
  const totalRules = clusterRules.length + securityGroups.reduce((acc, g) => acc + (g.rules?.length || 0), 0)
  const totalIPSetEntries = ipsets.reduce((acc, s) => acc + (s.members?.length || 0), 0)
  const firewallLoadError = [...new Set([loadError, hostRulesError, vmRulesError].filter(Boolean))].join(' · ')

  // ── Effects ──
  // No summary strip or alert above the tabs any more: a broken backend must still leave a trace to diagnose.
  useEffect(() => {
    if (selectedConnection && firewallLoadError) console.error('Network security: firewall data could not be loaded:', firewallLoadError)
  }, [selectedConnection, firewallLoadError])

  useEffect(() => {
    setPageInfo(t('network.title'), t('microseg.subtitle'), 'ri-shield-flash-fill')
    return () => setPageInfo('', '', '')
  }, [setPageInfo, t])

  // The connection shown is remembered: a reopen of the page starts on it, not on the first connection.
  useEffect(() => {
    if (selectedConnection) storeConnection(selectedConnection)
  }, [selectedConnection])

  useEffect(() => {
    setVMFirewallData([])
    setHostRulesByNode({})
  }, [selectedConnection, setVMFirewallData, setHostRulesByNode])

  // A standalone node has no cluster firewall: Firewalling opens on its host rules instead.
  const shownRulesSubTab = firewallMode === 'standalone' && rulesSubTab === 0 ? 1 : rulesSubTab

  // The guest list (firewall state, VLANs, tags) on Firewalling (tab 1: its guest sections and the VMs covered of its
  // status bar) and Security Groups only: one request to the coverage route, computed and cached on the
  // server with one Proxmox call per guest at most (UA44). A guest's rules are read when its section is opened,
  // never for every guest on mount.
  useEffect(() => {
    if (isEnterprise && selectedConnection && !loadingVMRules && vmFirewallData.length === 0) {
      if (activeTab === TAB.groups || activeTab === TAB.firewalling) {
        void loadVMFirewallData()
      }
    }
  }, [isEnterprise, activeTab, selectedConnection, vmFirewallData.length, loadingVMRules, loadVMFirewallData])

  // The Aliases and IP Sets tabs are the same objects view on the same data.
  const objectsProps = {
    aliases, ipsets, selectedConnection, loading, loadError: firewallLoadError || null, reload: loadFirewallData,
  }

  return (
    <ProviderTenantGuard>
    <EnterpriseGuard requiredFeature={Features.MICROSEGMENTATION} featureName="Microsegmentation / Firewall">
      <Box sx={{ minHeight: 'calc(100vh - 130px)', display: 'flex', flexDirection: 'column' }}>

        {!selectedConnection && !waitingForVm && (
          <Alert severity="info" sx={{ mb: 3 }}>
            {t('networkPage.noPveConnection')}
          </Alert>
        )}

        {/* Main Content Card */}
        <ConnectionKindsContext.Provider value={connectionKinds}>
        <MicrosegWriteContext.Provider value={canWriteFirewall}>
        <Card sx={{ background: alpha(theme.palette.background.paper, 0.8), backdropFilter: 'blur(10px)', border: `1px solid ${alpha(theme.palette.divider, 0.1)}`, borderRadius: 3, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
          <Tabs value={activeTab} onChange={(_, v) => changeTab(v)} variant="scrollable" scrollButtons="auto" sx={{ px: 2, flex: '1 1 460px', minWidth: 0 }}>
            <Tab value={TAB.dashboard} icon={<i className="ri-dashboard-line" />} iconPosition="start" label={t('firewall.dashboard')} sx={TAB_SX} />
            <Tab value={TAB.microseg} icon={<i className="ri-shield-keyhole-line" />} iconPosition="start" label={t('microsegPilot.tab.title')} sx={TAB_SX} />
            <Tab value={TAB.firewalling} icon={<i className="ri-shield-flash-line" />} iconPosition="start" label={t('networkPage.tabFirewalling')} sx={TAB_SX} />
            <Tab value={TAB.logging} icon={<i className="ri-terminal-box-line" />} iconPosition="start" label={t('networkPage.tabLogging')} sx={TAB_SX} />
            <Tab value={TAB.groups} icon={<i className="ri-shield-check-line" />} iconPosition="start" label={t('networkPage.tabSecurityGroups')} sx={TAB_SX} />
            <Tab value={TAB.ipsets} icon={<i className="ri-database-2-line" />} iconPosition="start" label={t('networkPage.tabIpSets')} sx={TAB_SX} />
            <Tab value={TAB.aliases} icon={<i className="ri-price-tag-3-line" />} iconPosition="start" label={t('networkPage.tabAliases')} sx={TAB_SX} />
          </Tabs>
            {/* Connection selector: right end of the tabs row, below the tabs on a narrow width; room above for its floating label */}
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexShrink: 0, ml: 'auto', px: 2, pt: 1.5, pb: 1 }}>
              <FormControl size="small" sx={{ minWidth: 200 }}>
                <InputLabel>{t('firewall.connection')}</InputLabel>
                {/* A group's label ("PVE-PROD + PVE-DR") is cut with an ellipsis; the whole label shows on hover. */}
                <Select
                  value={selectorValue}
                  label={t('firewall.connection')}
                  onChange={(e) => {
                    setPickedConnection(e.target.value)
                    setVMFirewallData([])
                  }}
                  renderValue={(value) => {
                    const entry = selectorItems.find(c => c.value === value)
                    return entry ? <ConnectionsLabel connections={visible(entry.ids, connections)} kinds={connectionKinds} title={entry.label} /> : null
                  }}
                  sx={{ maxWidth: 320 }}
                >
                  {selectorItems.map((c) => (
                    <MenuItem key={c.value} value={c.value} title={c.label} sx={{ maxWidth: 420 }}>
                      <ConnectionsLabel connections={visible(c.ids, connections)} kinds={connectionKinds} />
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              {groupsShown && connections.map(c => <ClusterGroupProbe key={c.id} connectionId={c.id} onGroup={reportGroup} />)}
              <IconButton onClick={loadFirewallData} disabled={loading || !selectedConnection} size="small">
                <i className={`ri-refresh-line ${loading ? 'animate-spin' : ''}`} />
              </IconButton>
            </Box>
          </Box>

          {/* Tab: Dashboard */}
          {activeTab === TAB.dashboard && (
            <DashboardTab
              securityGroups={securityGroups}
              clusterOptions={clusterOptions}
              clusterRules={clusterRules}
              aliases={aliases}
              ipsets={ipsets}
              firewallMode={firewallMode}
              currentOptions={currentOptions}
              selectedConnection={selectedConnection}
              connectionName={connections.find(c => c.id === selectedConnection)?.name}
              connections={connections}
              totalRules={totalRules}
              totalIPSetEntries={totalIPSetEntries}
              nodesList={nodesList}
              loadError={firewallLoadError || null}
              loading={loading}
              reload={loadFirewallData}
              onNavigateTab={changeTab}
              onNavigateRulesSubTab={setRulesSubTab}
              onOpenGuests={filter => { changeTab(TAB.firewalling); setRulesSubTab(2); setGuestFilter(filter ?? null) }}
              onOpenMicroseg={(subTab, focus) => { changeTab(TAB.microseg); setMicrosegSubTab(subTab ?? null); setObservationFocus(focus ?? null) }}
            />
          )}

          {/* Tab: Firewalling */}
          {activeTab === TAB.firewalling && (
            <RulesTab
              activeSubTab={shownRulesSubTab}
              onSubTabChange={setRulesSubTab}
              guestFilter={guestFilter}
              onClearGuestFilter={() => setGuestFilter(null)}
              clusterRules={clusterRules}
              setClusterRules={setClusterRules}
              clusterOptions={clusterOptions}
              setClusterOptions={setClusterOptions}
              hostRulesByNode={hostRulesByNode}
              setHostRulesByNode={setHostRulesByNode}
              nodesList={nodesList}
              nodeStatus={nodeStatus}
              vmFirewallData={vmFirewallData}
              setVMFirewallData={setVMFirewallData}
              loadingVMRules={loadingVMRules}
              loadVMFirewallData={loadVMFirewallData}
              loadGuestRules={loadGuestRules}
              securityGroups={securityGroups}
              aliases={aliases}
              ipsets={ipsets}
              firewallMode={firewallMode}
              selectedConnection={selectedConnection}
              connectionName={connections.find(c => c.id === selectedConnection)?.name}
              loadError={firewallLoadError || null}
              reload={loadFirewallData}
            />
          )}

          {/* Tab: Aliases */}
          {activeTab === TAB.aliases && (
            <ObjectsTab {...objectsProps} view="aliases" />
          )}

          {/* Tab: IP Sets */}
          {activeTab === TAB.ipsets && (
            <ObjectsTab {...objectsProps} view="ipsets" />
          )}

          {/* Tab: Security Groups */}
          {activeTab === TAB.groups && (
            <SecurityGroupsPanel
              securityGroups={securityGroups}
              vmFirewallData={vmFirewallData}
              loadingVMRules={loadingVMRules}
              guestsNotScanned={guestsNotScanned}
              clusterRules={clusterRules}
              hostRulesByNode={hostRulesByNode}
              selectedConnection={selectedConnection}
              totalRules={totalRules}
              aliases={aliases}
              ipsets={ipsets}
              loadError={firewallLoadError || null}
              reload={loadFirewallData}
              loadGuestRules={loadGuestRules}
              reloadVMFirewallRules={reloadVMFirewallRules}
              groupUsage={groupUsage}
              groupUsageLoading={groupUsageLoading}
              reloadGroupUsage={reloadGroupUsage}
              checkGroupUsage={checkGroupUsage}
              nodeStatus={nodeStatus}
            />
          )}

          {/* Tab: Logging (keyed: another connection starts from no element) */}
          {activeTab === TAB.logging && selectedConnection && (
            <LoggingTab
              key={selectedConnection}
              selectedConnection={selectedConnection}
              nodesList={nodesList}
              securityGroups={securityGroups}
              firewallMode={firewallMode}
              connections={connections}
            />
          )}


          {/* Tab: Micro-segmentation (keyed: another connection starts from no state) */}
          {activeTab === TAB.microseg && (
            <MicrosegTab
              key={selectedConnection}
              connectionId={selectedConnection}
              connectionName={connections.find(c => c.id === selectedConnection)?.name}
              initialSubTab={microsegSubTab ?? undefined}
              initialObservation={observationFocus}
              targetVm={linkedVm}
              connections={connections}
              groupedConnections={groupedConnections}
              onDissociated={followGroup}
              firewall={{ clusterOptions, clusterRules, nodesList, nodeStatus, firewallMode, onComplete: loadFirewallData }}
            />
          )}

        </Card>
        </MicrosegWriteContext.Provider>
        </ConnectionKindsContext.Provider>
      </Box>
    </EnterpriseGuard>
    </ProviderTenantGuard>
  )
}
