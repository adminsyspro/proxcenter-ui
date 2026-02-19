'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert, Box, Card, FormControl, IconButton, InputLabel, MenuItem,
  Select, Tab, Tabs, useTheme, alpha
} from '@mui/material'

import { usePageTitle } from "@/contexts/PageTitleContext"
import EnterpriseGuard from '@/components/guards/EnterpriseGuard'
import { Features, useLicense } from '@/contexts/LicenseContext'
import { useToast } from '@/contexts/ToastContext'
import * as firewallAPI from '@/lib/api/firewall'
import MicrosegmentationTab from '@/components/MicrosegmentationTab'
import { usePVEConnections } from '@/hooks/useConnections'
import { useFirewallData, Connection } from '@/hooks/useFirewallData'
import { useVMFirewallRules } from '@/hooks/useVMFirewallRules'
import { useHostFirewallRules } from '@/hooks/useHostFirewallRules'

import StatCard from './components/StatCard'
import DashboardTab from './components/DashboardTab'
import RulesTab from './components/RulesTab'
import ObjectsTab from './components/ObjectsTab'

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN PAGE — 4 tabs orchestrator
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
    if (firewallMode === 'standalone' && activeTab === 2 && rulesSubTab === 0) {
      setRulesSubTab(1)
    }
  }, [firewallMode, activeTab, rulesSubTab])

  // Load VM rules when on Dashboard (tab 0) or Rules > VMs (tab 2, subTab 2)
  useEffect(() => {
    if (isEnterprise && selectedConnection && !loadingVMRules && vmFirewallData.length === 0) {
      if (activeTab === 0 || (activeTab === 2 && (rulesSubTab === 0 || rulesSubTab === 2))) {
        loadVMFirewallData()
      }
    }
  }, [activeTab, rulesSubTab, selectedConnection, vmFirewallData.length, loadingVMRules, loadVMFirewallData])

  // ── Handlers ──
  const handleToggleClusterFirewall = async () => {
    try {
      const newEnable = clusterOptions?.enable === 1 ? 0 : 1
      await firewallAPI.updateClusterOptions(selectedConnection, { enable: newEnable })
      showToast(newEnable === 1 ? t('networkPage.firewallEnabled') : t('networkPage.firewallDisabled'), 'success')
      loadFirewallData()
    } catch (err: any) {
      showToast(err.message || t('networkPage.error'), 'error')
    }
  }

  return (
    <EnterpriseGuard requiredFeature={Features.MICROSEGMENTATION} featureName="Microsegmentation / Firewall">
      <Box sx={{ minHeight: '100vh', p: 3 }}>

        {/* Connection Selector */}
        <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel>Cluster</InputLabel>
              <Select value={selectedConnection} label="Cluster" onChange={(e) => {
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
          <StatCard icon="ri-shield-check-line" label="Security Groups" value={securityGroups.length} subvalue={t('networkPage.totalRules', { count: totalRules })} color="#22c55e" loading={loading} onClick={() => { setActiveTab(2); setRulesSubTab(3) }} />
          <StatCard icon="ri-database-2-line" label="IP Sets" value={ipsets.length} subvalue={`${totalIPSetEntries} ${t('networkPage.entries')}`} color="#3b82f6" loading={loading} onClick={() => setActiveTab(3)} />
          <StatCard icon="ri-price-tag-3-line" label="Aliases" value={aliases.length} subvalue={t('networkPage.namedNetworks')} color="#8b5cf6" loading={loading} onClick={() => setActiveTab(3)} />
          <StatCard icon="ri-cloud-line" label={t('network.clusterRules')} value={clusterRules.length} subvalue={clusterOptions?.enable === 1 ? t('network.firewallActive') : t('network.firewallInactive')} color={clusterOptions?.enable === 1 ? '#06b6d4' : '#94a3b8'} loading={loading} onClick={() => { setActiveTab(2); setRulesSubTab(0) }} />
        </Box>

        {/* Main Content Card */}
        <Card sx={{ background: alpha(theme.palette.background.paper, 0.8), backdropFilter: 'blur(10px)', border: `1px solid ${alpha(theme.palette.divider, 0.1)}`, borderRadius: 3 }}>
          <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} variant="scrollable" scrollButtons="auto" sx={{ px: 2, borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
            <Tab icon={<i className="ri-dashboard-line" />} iconPosition="start" label="Dashboard" sx={{ textTransform: 'none', fontWeight: 600, fontSize: 14 }} />
            <Tab icon={<i className="ri-shield-keyhole-line" />} iconPosition="start" label="Micro-segmentation" sx={{ textTransform: 'none', fontWeight: 600, fontSize: 14 }} />
            <Tab icon={<i className="ri-list-check-3" />} iconPosition="start" label={t('networkPage.tabRules')} sx={{ textTransform: 'none', fontWeight: 600, fontSize: 14 }} />
            <Tab icon={<i className="ri-archive-2-line" />} iconPosition="start" label={t('networkPage.tabObjects')} sx={{ textTransform: 'none', fontWeight: 600, fontSize: 14 }} />
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
              handleToggleClusterFirewall={handleToggleClusterFirewall}
              onNavigateTab={setActiveTab}
              onNavigateRulesSubTab={setRulesSubTab}
            />
          )}

          {/* Tab 1: Micro-segmentation */}
          {activeTab === 1 && selectedConnection && (
            <MicrosegmentationTab connectionId={selectedConnection} />
          )}
          {activeTab === 1 && !selectedConnection && (
            <Box sx={{ p: 3, textAlign: 'center' }}>
              <span style={{ color: theme.palette.text.secondary }}>{t('network.selectConnectionMicroseg')}</span>
            </Box>
          )}

          {/* Tab 2: Rules */}
          {activeTab === 2 && (
            <RulesTab
              activeSubTab={rulesSubTab}
              onSubTabChange={setRulesSubTab}
              clusterRules={clusterRules}
              setClusterRules={setClusterRules}
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
              firewallMode={firewallMode}
              totalRules={totalRules}
              selectedConnection={selectedConnection}
              reload={loadFirewallData}
            />
          )}

          {/* Tab 3: Objects */}
          {activeTab === 3 && (
            <ObjectsTab
              aliases={aliases}
              ipsets={ipsets}
              selectedConnection={selectedConnection}
              loading={loading}
              reload={loadFirewallData}
            />
          )}
        </Card>
      </Box>
    </EnterpriseGuard>
  )
}
