'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert, Box, Card, FormControl, IconButton, InputLabel, MenuItem,
  Select, Tab, Tabs, Typography, useTheme, alpha
} from '@mui/material'

import { usePageTitle } from "@/contexts/PageTitleContext"
import EnterpriseGuard from '@/components/guards/EnterpriseGuard'
import ProviderTenantGuard from '@/components/guards/ProviderTenantGuard'
import { Features, useLicense } from '@/contexts/LicenseContext'
import { useToast } from '@/contexts/ToastContext'
import * as firewallAPI from '@/lib/api/firewall'
import { usePVEConnections } from '@/hooks/useConnections'
import { useFirewallData, Connection } from '@/hooks/useFirewallData'
import { useVMFirewallRules } from '@/hooks/useVMFirewallRules'
import { useHostFirewallRules } from '@/hooks/useHostFirewallRules'

import DashboardTab from './components/DashboardTab'
import RulesTab from './components/RulesTab'
import ObjectsTab from './components/ObjectsTab'
import SecurityGroupsPanel from './components/rules/SecurityGroupsPanel'
import LoggingTab from './components/LoggingTab'
import MicrosegTab from './components/microseg/MicrosegTab'

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN PAGE — 7 tabs: Dashboard, Firewalling, Aliases, IP Sets, Security Groups, Logging, Micro-segmentation
═══════════════════════════════════════════════════════════════════════════ */

export default function NetworkAutomationPage() {
  const theme = useTheme()
  const { setPageInfo } = usePageTitle()
  const t = useTranslations()
  const { isEnterprise } = useLicense()
  const { showToast } = useToast()

  // ── State ──
  const [activeTab, setActiveTab] = useState(0)
  const [rulesSubTab, setRulesSubTab] = useState(0)
  const [selectedConnection, setSelectedConnection] = useState<string>('')

  // ── Connections ──
  const { data: connectionsData } = usePVEConnections()
  const connections: Connection[] = isEnterprise ? (connectionsData?.data || []) : []

  // ── Data hooks ──
  const {
    aliases, ipsets, securityGroups, clusterOptions, clusterRules,
    nodeOptions, nodeRules, firewallMode, connectionInfo, nodesList,
    loading, loadError, reload: loadFirewallData, setClusterRules, setClusterOptions,
  } = useFirewallData(isEnterprise ? selectedConnection || null : null, isEnterprise)

  const {
    vmFirewallData, loadingVMRules, vmRulesError, guestsNotScanned, loadVMFirewallData, reloadVMFirewallRules, setVMFirewallData,
  } = useVMFirewallRules(isEnterprise ? selectedConnection || null : null)

  const {
    hostRulesByNode, loadingHostRules, hostRulesError, loadHostRules, reloadHostRulesForNode, setHostRulesByNode,
  } = useHostFirewallRules(isEnterprise ? selectedConnection || null : null, nodesList)

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

  useEffect(() => {
    if (connections.length > 0 && !selectedConnection) {
      setSelectedConnection(connections[0].id)
    }
  }, [connections, selectedConnection])

  useEffect(() => {
    setVMFirewallData([])
    setHostRulesByNode({})
  }, [selectedConnection])

  // If standalone mode detected, switch away from Cluster sub-tab
  useEffect(() => {
    if (firewallMode === 'standalone' && activeTab === 1 && rulesSubTab === 0) {
      setRulesSubTab(1)
    }
  }, [firewallMode, activeTab, rulesSubTab])

  // Load VM rules when on Dashboard (tab 0), Firewalling > Cluster/VMs (tab 1,
  // subTab 0 or 2), or Security Groups (tab 4) — that last tab counts, per
  // group, the guests whose rules reference it, so without this it showed 0 VMs
  // everywhere while the data had simply never been fetched.
  useEffect(() => {
    if (isEnterprise && selectedConnection && !loadingVMRules && vmFirewallData.length === 0) {
      if (activeTab === 0 || activeTab === 4 || (activeTab === 1 && (rulesSubTab === 0 || rulesSubTab === 2))) {
        void loadVMFirewallData()
      }
    }
  }, [activeTab, rulesSubTab, selectedConnection, vmFirewallData.length, loadingVMRules, loadVMFirewallData])

  // The Aliases and IP Sets tabs are the same objects view on the same data.
  const objectsProps = {
    aliases, ipsets, selectedConnection, loading, loadError: firewallLoadError || null, reload: loadFirewallData,
  }

  return (
    <ProviderTenantGuard>
    <EnterpriseGuard requiredFeature={Features.MICROSEGMENTATION} featureName="Microsegmentation / Firewall">
      <Box sx={{ p: 3, minHeight: 'calc(100vh - 130px)', display: 'flex', flexDirection: 'column' }}>

        {!selectedConnection && (
          <Alert severity="info" sx={{ mb: 3 }}>
            {t('networkPage.noPveConnection')}
          </Alert>
        )}

        {/* Main Content Card */}
        <Card sx={{ background: alpha(theme.palette.background.paper, 0.8), backdropFilter: 'blur(10px)', border: `1px solid ${alpha(theme.palette.divider, 0.1)}`, borderRadius: 3, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
          <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} variant="scrollable" scrollButtons="auto" sx={{ px: 2, flex: '1 1 460px', minWidth: 0 }}>
            <Tab icon={<i className="ri-dashboard-line" />} iconPosition="start" label={t('firewall.dashboard')} sx={{ textTransform: 'none', fontWeight: 600, fontSize: 14 }} />
            <Tab icon={<i className="ri-shield-flash-line" />} iconPosition="start" label={t('networkPage.tabFirewalling')} sx={{ textTransform: 'none', fontWeight: 600, fontSize: 14 }} />
            <Tab icon={<i className="ri-price-tag-3-line" />} iconPosition="start" label={t('networkPage.tabAliases')} sx={{ textTransform: 'none', fontWeight: 600, fontSize: 14 }} />
            <Tab icon={<i className="ri-database-2-line" />} iconPosition="start" label={t('networkPage.tabIpSets')} sx={{ textTransform: 'none', fontWeight: 600, fontSize: 14 }} />
            <Tab icon={<i className="ri-shield-check-line" />} iconPosition="start" label={t('networkPage.tabSecurityGroups')} sx={{ textTransform: 'none', fontWeight: 600, fontSize: 14 }} />
            <Tab icon={<i className="ri-terminal-box-line" />} iconPosition="start" label={t('networkPage.tabLogging')} sx={{ textTransform: 'none', fontWeight: 600, fontSize: 14 }} />
            <Tab icon={<i className="ri-shield-keyhole-line" />} iconPosition="start" label={t('microsegPilot.tab.title')} sx={{ textTransform: 'none', fontWeight: 600, fontSize: 14 }} />
          </Tabs>
            {/* Connection selector: right end of the tabs row, below the tabs on a narrow width */}
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexShrink: 0, ml: 'auto', px: 2, py: 1 }}>
              <FormControl size="small" sx={{ minWidth: 200 }}>
                <InputLabel>{t('firewall.connection')}</InputLabel>
                <Select value={selectedConnection} label={t('firewall.connection')} onChange={(e) => {
                  setSelectedConnection(e.target.value)
                  setVMFirewallData([])
                }}>
                  {connections.map((c) => (
                    <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <IconButton onClick={loadFirewallData} disabled={loading || !selectedConnection} size="small">
                <i className={`ri-refresh-line ${loading ? 'animate-spin' : ''}`} />
              </IconButton>
            </Box>
          </Box>

          {/* Tab 0: Dashboard */}
          {activeTab === 0 && (
            <DashboardTab
              securityGroups={securityGroups}
              clusterOptions={clusterOptions}
              clusterRules={clusterRules}
              aliases={aliases}
              ipsets={ipsets}
              vmFirewallData={vmFirewallData}
              loadingVMRules={loadingVMRules}
              firewallMode={firewallMode}
              currentOptions={currentOptions}
              selectedConnection={selectedConnection}
              totalRules={totalRules}
              totalIPSetEntries={totalIPSetEntries}
              nodesList={nodesList}
              loadError={firewallLoadError || null}
              loading={loading}
              reload={loadFirewallData}
              onNavigateTab={setActiveTab}
              onNavigateRulesSubTab={setRulesSubTab}
            />
          )}

          {/* Tab 1: Firewalling */}
          {activeTab === 1 && (
            <RulesTab
              activeSubTab={rulesSubTab}
              onSubTabChange={setRulesSubTab}
              clusterRules={clusterRules}
              setClusterRules={setClusterRules}
              clusterOptions={clusterOptions}
              setClusterOptions={setClusterOptions}
              hostRulesByNode={hostRulesByNode}
              nodesList={nodesList}
              loadingHostRules={loadingHostRules}
              loadHostRules={loadHostRules}
              reloadHostRulesForNode={reloadHostRulesForNode}
              vmFirewallData={vmFirewallData}
              loadingVMRules={loadingVMRules}
              loadVMFirewallData={loadVMFirewallData}
              reloadVMFirewallRules={reloadVMFirewallRules}
              securityGroups={securityGroups}
              aliases={aliases}
              ipsets={ipsets}
              firewallMode={firewallMode}
              totalRules={totalRules}
              selectedConnection={selectedConnection}
              loadError={firewallLoadError || null}
              reload={loadFirewallData}
            />
          )}

          {/* Tab 2: Aliases */}
          {activeTab === 2 && (
            <ObjectsTab {...objectsProps} view="aliases" />
          )}

          {/* Tab 3: IP Sets */}
          {activeTab === 3 && (
            <ObjectsTab {...objectsProps} view="ipsets" />
          )}

          {/* Tab 4: Security Groups */}
          {activeTab === 4 && (
            <SecurityGroupsPanel
              securityGroups={securityGroups}
              vmFirewallData={vmFirewallData}
              loadingVMRules={loadingVMRules}
              guestsNotScanned={guestsNotScanned}
              clusterRules={clusterRules}
              hostRulesByNode={hostRulesByNode}
              firewallMode={firewallMode}
              selectedConnection={selectedConnection}
              totalRules={totalRules}
              aliases={aliases}
              ipsets={ipsets}
              loadError={firewallLoadError || null}
              reload={loadFirewallData}
              reloadVMFirewallRules={reloadVMFirewallRules}
            />
          )}

          {/* Tab 5: Logging (keyed: another connection starts from no element) */}
          {activeTab === 5 && selectedConnection && (
            <LoggingTab
              key={selectedConnection}
              selectedConnection={selectedConnection}
              nodesList={nodesList}
              securityGroups={securityGroups}
              firewallMode={firewallMode}
            />
          )}

          {/* Tab 6: Micro-segmentation (keyed: another connection starts from no state) */}
          {activeTab === 6 && (
            <MicrosegTab
              key={selectedConnection}
              connectionId={selectedConnection}
              connectionName={connections.find(c => c.id === selectedConnection)?.name}
              firewall={{ clusterOptions, clusterRules, nodesList, firewallMode, onComplete: loadFirewallData }}
            />
          )}

        </Card>
      </Box>
    </EnterpriseGuard>
    </ProviderTenantGuard>
  )
}
