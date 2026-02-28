'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert, Box, Card, FormControl, IconButton, InputLabel, MenuItem,
  Select, Tab, Tabs, Typography, useTheme, alpha
} from '@mui/material'

import { usePageTitle } from "@/contexts/PageTitleContext"
import EnterpriseGuard from '@/components/guards/EnterpriseGuard'
import { Features, useLicense } from '@/contexts/LicenseContext'
import { useToast } from '@/contexts/ToastContext'
import * as firewallAPI from '@/lib/api/firewall'
import { usePVEConnections } from '@/hooks/useConnections'
import { useFirewallData, Connection } from '@/hooks/useFirewallData'
import { useVMFirewallRules } from '@/hooks/useVMFirewallRules'
import { useHostFirewallRules } from '@/hooks/useHostFirewallRules'

import StatCard from './components/StatCard'
import DashboardTab from './components/DashboardTab'
import RulesTab from './components/RulesTab'
import ObjectsTab from './components/ObjectsTab'
import SecurityGroupsPanel from './components/rules/SecurityGroupsPanel'

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN PAGE — 5 tabs: Dashboard, Firewalling, Aliases, IP Sets, Security Groups
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
    loading, reload: loadFirewallData, setClusterRules, setClusterOptions,
  } = useFirewallData(isEnterprise ? selectedConnection || null : null, isEnterprise)

  const {
    vmFirewallData, loadingVMRules, loadVMFirewallData, reloadVMFirewallRules, setVMFirewallData,
  } = useVMFirewallRules(isEnterprise ? selectedConnection || null : null)

  const {
    hostRulesByNode, loadingHostRules, loadHostRules, reloadHostRulesForNode, setHostRulesByNode,
  } = useHostFirewallRules(isEnterprise ? selectedConnection || null : null, nodesList)

  // ── Derived values ──
  const currentOptions = firewallMode === 'cluster' ? clusterOptions : nodeOptions
  const totalRules = clusterRules.length + securityGroups.reduce((acc, g) => acc + (g.rules?.length || 0), 0)
  const totalIPSetEntries = ipsets.reduce((acc, s) => acc + (s.members?.length || 0), 0)

  // ── Effects ──
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

  // Load VM rules when on Dashboard (tab 0) or Firewalling > VMs (tab 1, subTab 2)
  useEffect(() => {
    if (isEnterprise && selectedConnection && !loadingVMRules && vmFirewallData.length === 0) {
      if (activeTab === 0 || (activeTab === 1 && (rulesSubTab === 0 || rulesSubTab === 2))) {
        loadVMFirewallData()
      }
    }
  }, [activeTab, rulesSubTab, selectedConnection, vmFirewallData.length, loadingVMRules, loadVMFirewallData])

  return (
    <EnterpriseGuard requiredFeature={Features.MICROSEGMENTATION} featureName="Microsegmentation / Firewall">
      <Box sx={{ minHeight: '100vh', p: 3 }}>

        {/* Connection Selector */}
        <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
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

        {!selectedConnection && (
          <Alert severity="info" sx={{ mb: 3 }}>
            {t('networkPage.noPveConnection')}
          </Alert>
        )}

        {/* Stats Grid */}
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' },
          gap: 2, mb: 3, width: '100%'
        }}>
          <StatCard icon="ri-shield-check-line" label={t('firewall.securityGroups')} value={securityGroups.length} subvalue={t('networkPage.totalRules', { count: totalRules })} color="#22c55e" loading={loading} onClick={() => setActiveTab(4)} />
          <StatCard icon="ri-database-2-line" label={t('firewall.ipSets')} value={ipsets.length} subvalue={`${totalIPSetEntries} ${t('networkPage.entries')}`} color="#3b82f6" loading={loading} onClick={() => setActiveTab(3)} />
          <StatCard icon="ri-price-tag-3-line" label={t('firewall.aliases')} value={aliases.length} subvalue={t('networkPage.namedNetworks')} color="#8b5cf6" loading={loading} onClick={() => setActiveTab(2)} />
          <StatCard icon="ri-cloud-line" label={t('network.clusterRules')} value={clusterRules.length} subvalue={clusterOptions?.enable === 1 ? t('network.firewallActive') : t('network.firewallInactive')} color={clusterOptions?.enable === 1 ? '#06b6d4' : '#94a3b8'} loading={loading} onClick={() => { setActiveTab(1); setRulesSubTab(0) }} />
        </Box>

        {/* Main Content Card */}
        <Card sx={{ background: alpha(theme.palette.background.paper, 0.8), backdropFilter: 'blur(10px)', border: `1px solid ${alpha(theme.palette.divider, 0.1)}`, borderRadius: 3 }}>
          <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} variant="scrollable" scrollButtons="auto" sx={{ px: 2, borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
            <Tab icon={<i className="ri-dashboard-line" />} iconPosition="start" label={t('firewall.dashboard')} sx={{ textTransform: 'none', fontWeight: 600, fontSize: 14 }} />
            <Tab icon={<i className="ri-shield-flash-line" />} iconPosition="start" label={t('networkPage.tabFirewalling')} sx={{ textTransform: 'none', fontWeight: 600, fontSize: 14 }} />
            <Tab icon={<i className="ri-price-tag-3-line" />} iconPosition="start" label={t('networkPage.tabAliases')} sx={{ textTransform: 'none', fontWeight: 600, fontSize: 14 }} />
            <Tab icon={<i className="ri-database-2-line" />} iconPosition="start" label={t('networkPage.tabIpSets')} sx={{ textTransform: 'none', fontWeight: 600, fontSize: 14 }} />
            <Tab icon={<i className="ri-shield-check-line" />} iconPosition="start" label={t('networkPage.tabSecurityGroups')} sx={{ textTransform: 'none', fontWeight: 600, fontSize: 14 }} />
          </Tabs>

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
              reload={loadFirewallData}
            />
          )}

          {/* Tab 2: Aliases */}
          {activeTab === 2 && (
            <ObjectsTab
              aliases={aliases}
              ipsets={ipsets}
              selectedConnection={selectedConnection}
              loading={loading}
              reload={loadFirewallData}
              view="aliases"
            />
          )}

          {/* Tab 3: IP Sets */}
          {activeTab === 3 && (
            <ObjectsTab
              aliases={aliases}
              ipsets={ipsets}
              selectedConnection={selectedConnection}
              loading={loading}
              reload={loadFirewallData}
              view="ipsets"
            />
          )}

          {/* Tab 4: Security Groups */}
          {activeTab === 4 && (
            <SecurityGroupsPanel
              securityGroups={securityGroups}
              vmFirewallData={vmFirewallData}
              firewallMode={firewallMode}
              selectedConnection={selectedConnection}
              totalRules={totalRules}
              aliases={aliases}
              ipsets={ipsets}
              reload={loadFirewallData}
            />
          )}
        </Card>
      </Box>
    </EnterpriseGuard>
  )
}
