'use client'

import { useState, useEffect, useCallback } from 'react'

import { useTranslations } from 'next-intl'

import useSWR from 'swr'

import {
  Box, Button, Card, CardContent, Chip, Grid, IconButton, 
  Stack, Tab, Tabs, TextField, Typography, 
  useTheme, alpha, Avatar, Divider, Paper,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Switch, Dialog, DialogTitle, DialogContent, DialogActions,
  FormControl, InputLabel, Select, MenuItem, Alert, Snackbar,
  Skeleton, Collapse, Tooltip, LinearProgress, CircularProgress
} from '@mui/material'
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip as RTooltip } from 'recharts'

import { usePageTitle } from "@/contexts/PageTitleContext"
import * as firewallAPI from '@/lib/api/firewall'
import MicrosegmentationTab from '@/components/MicrosegmentationTab'

/* ═══════════════════════════════════════════════════════════════════════════
   TYPES
═══════════════════════════════════════════════════════════════════════════ */

interface Connection {
  id: string
  name: string
  type: 'pve' | 'pbs'
  baseUrl: string
}

interface EditingRule {
  groupName: string
  rule: firewallAPI.FirewallRule
  index: number
}

interface VMFirewallInfo {
  vmid: number
  name: string
  node: string
  type: 'qemu' | 'lxc'
  status: string
  firewallEnabled: boolean
  rules: firewallAPI.FirewallRule[]
  options: firewallAPI.VMOptions | null
}

/* ═══════════════════════════════════════════════════════════════════════════
   FETCHER
═══════════════════════════════════════════════════════════════════════════ */

const fetcher = (url: string) => fetch(url).then(res => {
  if (!res.ok) throw new Error('Failed to fetch')
  
return res.json()
})

/* ═══════════════════════════════════════════════════════════════════════════
   COLORS
═══════════════════════════════════════════════════════════════════════════ */

const GROUP_COLORS = [
  '#22c55e', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4', 
  '#ec4899', '#10b981', '#6366f1', '#f97316', '#14b8a6', '#a855f7',
  '#eab308', '#84cc16'
]

const getGroupColor = (index: number): string => GROUP_COLORS[index % GROUP_COLORS.length]

/* ═══════════════════════════════════════════════════════════════════════════
   HELPER COMPONENTS
═══════════════════════════════════════════════════════════════════════════ */

const StatCard = ({ icon, label, value, subvalue, color, loading, onClick }: {
  icon: string
  label: string
  value: string | number
  subvalue?: string
  color: string
  loading?: boolean
  onClick?: () => void
}) => {
  const theme = useTheme()

  
return (
    <Card 
      onClick={onClick}
      sx={{ 
        height: '100%',
        background: theme.palette.mode === 'dark' 
          ? `linear-gradient(135deg, ${alpha(color, 0.1)} 0%, ${alpha(color, 0.05)} 100%)`
          : `linear-gradient(135deg, ${alpha(color, 0.08)} 0%, ${alpha(color, 0.03)} 100%)`,
        border: `1px solid ${alpha(color, 0.2)}`,
        position: 'relative',
        overflow: 'hidden',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.2s',
        '&:hover': onClick ? { transform: 'translateY(-2px)', boxShadow: `0 8px 24px ${alpha(color, 0.2)}` } : {},
        '&::before': { content: '""', position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: color }
      }}
    >
      <CardContent sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block' }}>{label}</Typography>
          {loading ? (
            <Skeleton width="60px" height={32} />
          ) : (
            <Typography variant="h4" sx={{ fontWeight: 900, color, lineHeight: 1.2 }}>{value}</Typography>
          )}
          {subvalue && <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 11 }}>{subvalue}</Typography>}
        </Box>
        <Box sx={{ width: 44, height: 44, borderRadius: 2, bgcolor: alpha(color, 0.15), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <i className={icon} style={{ fontSize: 22, color }} />
        </Box>
      </CardContent>
    </Card>
  )
}

const StatusBadge = ({ status }: { status: string }) => {
  const config: Record<string, { color: string; icon: string; label: string }> = {
    active: { color: '#22c55e', icon: 'ri-checkbox-circle-fill', label: 'Active' },
    enabled: { color: '#22c55e', icon: 'ri-checkbox-circle-fill', label: 'Enabled' },
    disabled: { color: '#94a3b8', icon: 'ri-close-circle-fill', label: 'Disabled' },
  }

  const { color, icon, label } = config[status] || config.disabled

  
return (
    <Chip size="small" icon={<i className={icon} style={{ fontSize: 14, color }} />} label={label}
      sx={{ height: 22, fontSize: 10, fontWeight: 700, bgcolor: alpha(color, 0.15), color, border: `1px solid ${alpha(color, 0.3)}` }} />
  )
}

const ActionChip = ({ action }: { action: string }) => {
  const colors: Record<string, string> = { ACCEPT: '#22c55e', DROP: '#ef4444', REJECT: '#f59e0b' }
  const color = colors[action] || '#94a3b8'

  
return (
    <Chip size="small" label={action} sx={{ height: 22, fontSize: 11, fontWeight: 700, bgcolor: alpha(color, 0.15), color, border: `1px solid ${alpha(color, 0.3)}`, minWidth: 70 }} />
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN PAGE
═══════════════════════════════════════════════════════════════════════════ */

export default function NetworkAutomationPage() {
  const theme = useTheme()
  const { setPageInfo } = usePageTitle()
  const t = useTranslations()

  // State
  const [activeTab, setActiveTab] = useState(0)
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' })
  
  // Connection selection
  const [selectedConnection, setSelectedConnection] = useState<string>('')
  
  // Firewall mode (cluster vs standalone)
  const [firewallMode, setFirewallMode] = useState<firewallAPI.FirewallMode>('cluster')
  const [connectionInfo, setConnectionInfo] = useState<firewallAPI.ConnectionFirewallInfo | null>(null)
  
  // Firewall data
  const [aliases, setAliases] = useState<firewallAPI.Alias[]>([])
  const [ipsets, setIPSets] = useState<firewallAPI.IPSet[]>([])
  const [securityGroups, setSecurityGroups] = useState<firewallAPI.SecurityGroup[]>([])
  const [clusterOptions, setClusterOptions] = useState<firewallAPI.ClusterOptions | null>(null)
  const [clusterRules, setClusterRules] = useState<firewallAPI.FirewallRule[]>([])
  const [nodeOptions, setNodeOptions] = useState<firewallAPI.NodeOptions | null>(null)
  const [nodeRules, setNodeRules] = useState<firewallAPI.FirewallRule[]>([])
  
  // Host rules per node (for cluster mode)
  const [nodesList, setNodesList] = useState<string[]>([])
  const [hostRulesByNode, setHostRulesByNode] = useState<Record<string, firewallAPI.FirewallRule[]>>({})
  const [loadingHostRules, setLoadingHostRules] = useState(false)
  
  // VM Firewall data
  const [vmFirewallData, setVMFirewallData] = useState<VMFirewallInfo[]>([])
  const [loadingVMRules, setLoadingVMRules] = useState(false)
  const [expandedVMs, setExpandedVMs] = useState<Set<number>>(new Set())
  const [selectedVMForRule, setSelectedVMForRule] = useState<VMFirewallInfo | null>(null)
  const [vmSearchQuery, setVmSearchQuery] = useState('')
  const [vmRuleDialogOpen, setVmRuleDialogOpen] = useState(false)
  const [editingVMRule, setEditingVMRule] = useState<{ vm: VMFirewallInfo; rule: firewallAPI.FirewallRule | null; isNew: boolean } | null>(null)
  const [deleteVMRuleConfirm, setDeleteVMRuleConfirm] = useState<{ vm: VMFirewallInfo; pos: number } | null>(null)

  const [newVMRule, setNewVMRule] = useState<firewallAPI.CreateRuleRequest>({ 
    type: 'in', action: 'ACCEPT', enable: 1, proto: '', dport: '', sport: '', source: '', dest: '', macro: '', iface: '', log: 'nolog', comment: '' 
  })
  
  // UI State
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [editingAlias, setEditingAlias] = useState<firewallAPI.Alias | null>(null)
  const [editingIPSet, setEditingIPSet] = useState<{ name: string; comment: string } | null>(null)
  const [editingRule, setEditingRule] = useState<EditingRule | null>(null)
  const [ipsetEntryDialog, setIPSetEntryDialog] = useState<{ open: boolean; ipsetName: string }>({ open: false, ipsetName: '' })
  const [newIPSetEntry, setNewIPSetEntry] = useState({ cidr: '', comment: '' })
  
  // Dialogs
  const [aliasDialogOpen, setAliasDialogOpen] = useState(false)
  const [ipsetDialogOpen, setIPSetDialogOpen] = useState(false)
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false)
  const [selectedGroup, setSelectedGroup] = useState<firewallAPI.SecurityGroup | null>(null)
  
  // Form state
  const [newAlias, setNewAlias] = useState({ name: '', cidr: '', comment: '' })
  const [newIPSet, setNewIPSet] = useState({ name: '', comment: '' })
  const [newGroup, setNewGroup] = useState({ group: '', comment: '' })
  const [newRule, setNewRule] = useState<firewallAPI.CreateRuleRequest>({ type: 'in', action: 'ACCEPT', enable: 1, proto: '', dport: '', source: '', dest: '', comment: '' })

  // Drag & drop state for Security Groups
  const [sgDragState, setSgDragState] = useState<{ groupName: string; draggedPos: number | null; dragOverPos: number | null }>({ groupName: '', draggedPos: null, dragOverPos: null })
  
  // Drag & drop state for VM Rules  
  const [vmDragState, setVmDragState] = useState<{ vmid: number; draggedPos: number | null; dragOverPos: number | null }>({ vmid: 0, draggedPos: null, dragOverPos: null })
  
  // Drag & drop state for Host Rules
  const [hostDragState, setHostDragState] = useState<{ node: string; draggedPos: number | null; dragOverPos: number | null }>({ node: '', draggedPos: null, dragOverPos: null })
  
  // Drag & drop state for Cluster Rules
  const [clusterDragState, setClusterDragState] = useState<{ draggedPos: number | null; dragOverPos: number | null }>({ draggedPos: null, dragOverPos: null })

  // Host Rules UI State
  const [expandedHosts, setExpandedHosts] = useState<Set<string>>(new Set())
  const [hostSearchQuery, setHostSearchQuery] = useState('')
  const [editingHostRule, setEditingHostRule] = useState<{ node: string; rule: firewallAPI.FirewallRule | null; isNew: boolean } | null>(null)
  const [deleteHostRuleConfirm, setDeleteHostRuleConfirm] = useState<{ node: string; pos: number } | null>(null)
  const [hostRuleDialogOpen, setHostRuleDialogOpen] = useState(false)

  const [newHostRule, setNewHostRule] = useState<firewallAPI.CreateRuleRequest>({ 
    type: 'in', action: 'ACCEPT', enable: 1, proto: '', dport: '', sport: '', source: '', dest: '', macro: '', iface: '', log: 'nolog', comment: '' 
  })

  // Cluster Rules UI State
  const [editingClusterRule, setEditingClusterRule] = useState<{ rule: firewallAPI.FirewallRule | null; isNew: boolean } | null>(null)
  const [deleteClusterRuleConfirm, setDeleteClusterRuleConfirm] = useState<{ pos: number } | null>(null)
  const [clusterRuleDialogOpen, setClusterRuleDialogOpen] = useState(false)

  const [newClusterRule, setNewClusterRule] = useState<firewallAPI.CreateRuleRequest>({ 
    type: 'in', action: 'ACCEPT', enable: 1, proto: '', dport: '', sport: '', source: '', dest: '', macro: '', iface: '', log: 'nolog', comment: '' 
  })

  // Filtered hosts for search
  const filteredHosts = nodesList.filter(node => 
    !hostSearchQuery || node.toLowerCase().includes(hostSearchQuery.toLowerCase())
  )
  
  // Filtered VM data for search
  const filteredVMData = vmFirewallData.filter(vm => 
    !vmSearchQuery || 
    vm.name.toLowerCase().includes(vmSearchQuery.toLowerCase()) ||
    vm.vmid.toString().includes(vmSearchQuery) ||
    vm.node.toLowerCase().includes(vmSearchQuery.toLowerCase())
  )
  
  // Helper to get current firewall options (cluster or node)
  const currentOptions = firewallMode === 'cluster' ? clusterOptions : nodeOptions
  const currentRules = firewallMode === 'cluster' ? clusterRules : nodeRules
  
  useEffect(() => {
    setPageInfo(t('network.title'), t('microseg.subtitle'), 'ri-shield-flash-fill')

return () => setPageInfo('', '', '')
  }, [setPageInfo, t])
  
  // Load connections with SWR - filter PVE only
  const { data: connectionsData } = useSWR<{ data: Connection[] }>('/api/v1/connections?type=pve', fetcher)
  const connections = connectionsData?.data || []
  
  // Set first connection when loaded
  useEffect(() => {
    if (connections.length > 0 && !selectedConnection) {
      setSelectedConnection(connections[0].id)
    }
  }, [connections, selectedConnection])
  
  // Reset VM firewall data when connection changes
  useEffect(() => {
    setVMFirewallData([])
    setExpandedVMs(new Set())
    setHostRulesByNode({})
    setNodesList([])
    setExpandedHosts(new Set())
    setFirewallMode('cluster') // Reset mode
  }, [selectedConnection])
  
  // Load firewall data when connection changes
  const [loading, setLoading] = useState(false)
  
  const loadFirewallData = useCallback(async () => {
    if (!selectedConnection) return
    
    setLoading(true)

    // Clear previous data first
    setNodesList([])
    setHostRulesByNode({})
    
    try {
      // First, try to get connection info to determine mode
      // For now, we'll detect based on cluster options availability
      // In a real implementation, this would be a dedicated API call
      
      const [aliasesData, ipsetsData, groupsData, clusterOpts, clusterRulesData] = await Promise.all([
        firewallAPI.getAliases(selectedConnection).catch(() => []),
        firewallAPI.getIPSets(selectedConnection).catch(() => []),
        firewallAPI.getSecurityGroups(selectedConnection).catch(() => []),
        firewallAPI.getClusterOptions(selectedConnection).catch(() => null),
        firewallAPI.getClusterRules(selectedConnection).catch(() => []),
      ])
      
      setAliases(Array.isArray(aliasesData) ? aliasesData : [])
      setIPSets(Array.isArray(ipsetsData) ? ipsetsData : [])
      setSecurityGroups(Array.isArray(groupsData) ? groupsData : [])
      setClusterOptions(clusterOpts)
      setClusterRules(Array.isArray(clusterRulesData) ? clusterRulesData : [])
      
      // Fetch nodes list from VMs API
      let nodes: string[] = []

      try {
        const vmsResp = await fetch(`/api/v1/vms?connId=${selectedConnection}`)

        if (vmsResp.ok) {
          const vmsJson = await vmsResp.json()
          const vms = vmsJson?.data?.vms || []


          // Extract unique nodes
          nodes = [...new Set(vms.map((vm: any) => vm.node).filter(Boolean))] as string[]
          setNodesList(nodes)
        }
      } catch {
        setNodesList([])
      }
      
      // Detect mode: standalone if only 1 node, cluster if multiple nodes
      // A single-node setup is considered standalone even if cluster API responds
      const isStandalone = nodes.length <= 1
      
      if (!isStandalone) {
        setFirewallMode('cluster')
        setConnectionInfo({
          mode: 'cluster',
          node_count: nodes.length,
          primary_node: '',
          has_cluster_fw: true,
          has_node_fw: true,
        })
      } else {
        setFirewallMode('standalone')
        const standaloneNode = nodes[0] || 'pve'

        setConnectionInfo({
          mode: 'standalone',
          node_count: 1,
          primary_node: standaloneNode,
          has_cluster_fw: false,
          has_node_fw: true,
        })
        
        // If currently on Cluster Rules tab, switch to Host Rules
        if (activeTab === 7) {
          setActiveTab(6)
        }
        
        // In standalone mode, load node-level firewall options
        try {
          const nodeOpts = await firewallAPI.getNodeOptions(selectedConnection, standaloneNode)

          setNodeOptions(nodeOpts)
          const nodeRulesData = await firewallAPI.getNodeRules(selectedConnection, standaloneNode)

          setNodeRules(Array.isArray(nodeRulesData) ? nodeRulesData : [])
        } catch {
          // Node firewall might not be configured
          setNodeOptions(null)
          setNodeRules([])
        }
      }
    } catch (err: any) {
      console.error('Failed to load firewall data:', err)
    } finally {
      setLoading(false)
    }
  }, [selectedConnection, activeTab])
  
  // Load host rules when switching to Host Rules tab
  const loadHostRules = useCallback(async (connectionId?: string, nodes?: string[]) => {
    const connId = connectionId || selectedConnection
    const nodeList = nodes || nodesList
    
    if (!connId || nodeList.length === 0) return
    
    setLoadingHostRules(true)

    try {
      const rulesMap: Record<string, firewallAPI.FirewallRule[]> = {}
      
      await Promise.all(
        nodeList.map(async (node) => {
          try {
            const rules = await firewallAPI.getNodeRules(connId, node)

            rulesMap[node] = Array.isArray(rules) ? rules : []
          } catch {
            rulesMap[node] = []
          }
        })
      )
      
      setHostRulesByNode(rulesMap)
    } catch (err) {
      console.error('Failed to load host rules:', err)
    } finally {
      setLoadingHostRules(false)
    }
  }, [selectedConnection, nodesList])
  
  // Load host rules when tab 6 is selected (Host Rules) - only if data not already loaded
  useEffect(() => {
    // Only load if on Host Rules tab and we have nodes but no rules loaded yet
    if (activeTab === 6 && selectedConnection && nodesList.length > 0 && Object.keys(hostRulesByNode).length === 0) {
      loadHostRules()
    }
  }, [activeTab, selectedConnection, nodesList, loadHostRules])
  
  useEffect(() => {
    if (selectedConnection) {
      loadFirewallData()
    }
  }, [selectedConnection, loadFirewallData])
  
  // Helper: Check if firewall is enabled on any NIC from VM config
  const checkNICFirewallEnabled = (config: Record<string, any>): boolean => {
    // Check net0, net1, net2, etc. for firewall=1
    for (let i = 0; i < 10; i++) {
      const netConfig = config[`net${i}`]

      if (netConfig && typeof netConfig === 'string' && netConfig.includes('firewall=1')) {
        return true
      }
    }

    
return false
  }
  
  // Load VM firewall rules when tab 4 (VM Rules) is selected
  const loadVMFirewallData = useCallback(async () => {
    if (!selectedConnection) return
    
    setLoadingVMRules(true)
    
    try {
      // Get all VMs for this connection using the correct API
      const vmsResp = await fetch(`/api/v1/vms?connId=${selectedConnection}`)
      const vmsData = await vmsResp.json()
      const guests = vmsData?.data?.vms || []
      
      // Load firewall rules for each VM (limit to avoid too many requests)
      const vmData: VMFirewallInfo[] = []
      
      for (const guest of guests.slice(0, 50)) { // Limit to 50 VMs
        try {
          // Fetch rules, options, and VM config (for NIC firewall status)
          const [rulesData, optionsData, configResp] = await Promise.all([
            firewallAPI.getVMRules(selectedConnection, guest.node, guest.type, guest.vmid).catch(() => []),
            firewallAPI.getVMOptions(selectedConnection, guest.node, guest.type, guest.vmid).catch(() => null),
            fetch(`/api/v1/connections/${selectedConnection}/guests/${guest.type}/${guest.node}/${guest.vmid}/config`).then(r => r.json()).catch(() => null)
          ])
          
          // Firewall is "active" if enabled on at least one NIC
          const nicFirewallEnabled = configResp?.data ? checkNICFirewallEnabled(configResp.data) : false
          
          vmData.push({
            vmid: parseInt(guest.vmid, 10),
            name: guest.name || `VM ${guest.vmid}`,
            node: guest.node,
            type: guest.type,
            status: guest.status,
            firewallEnabled: nicFirewallEnabled,
            rules: Array.isArray(rulesData) ? rulesData : [],
            options: optionsData
          })
        } catch {
          vmData.push({
            vmid: parseInt(guest.vmid, 10),
            name: guest.name || `VM ${guest.vmid}`,
            node: guest.node,
            type: guest.type,
            status: guest.status,
            firewallEnabled: false,
            rules: [],
            options: null
          })
        }
      }
      
      // Sort by firewall enabled first, then by rule count
      vmData.sort((a, b) => {
        if (a.firewallEnabled !== b.firewallEnabled) return b.firewallEnabled ? 1 : -1
        
return b.rules.length - a.rules.length
      })
      
      setVMFirewallData(vmData)
    } catch (err) {
      console.error('Failed to load VM firewall data:', err)
      setVMFirewallData([])
    } finally {
      setLoadingVMRules(false)
    }
  }, [selectedConnection])
  
  // Load VM rules when on Overview (tab 0) or VM Rules tab (tab 5)
  // Also reload when connection changes
  useEffect(() => {
    if ((activeTab === 0 || activeTab === 5) && selectedConnection && !loadingVMRules) {
      // Always reload when on these tabs (vmFirewallData is reset when connection changes)
      if (vmFirewallData.length === 0) {
        loadVMFirewallData()
      }
    }
  }, [activeTab, selectedConnection, vmFirewallData.length, loadingVMRules, loadVMFirewallData])
  
  // Toggle VM expansion
  const toggleVM = (vmid: number) => {
    setExpandedVMs(prev => {
      const next = new Set(prev)

      if (next.has(vmid)) next.delete(vmid)
      else next.add(vmid)
      
return next
    })
  }
  
  // VM Rule CRUD handlers
  const openVMRuleDialog = (vm: VMFirewallInfo, rule: firewallAPI.FirewallRule | null = null) => {
    setEditingVMRule({ vm, rule, isNew: !rule })

    if (rule) {
      setNewVMRule({
        type: rule.type || 'in',
        action: rule.action || 'ACCEPT',
        enable: rule.enable ?? 1,
        proto: rule.proto || '',
        dport: rule.dport || '',
        sport: rule.sport || '',
        source: rule.source || '',
        dest: rule.dest || '',
        macro: rule.macro || '',
        iface: rule.iface || '',
        log: rule.log || 'nolog',
        comment: rule.comment || ''
      })
    } else {
      setNewVMRule({ type: 'in', action: 'ACCEPT', enable: 1, proto: '', dport: '', sport: '', source: '', dest: '', macro: '', iface: '', log: 'nolog', comment: '' })
    }

    setVmRuleDialogOpen(true)
  }
  
  // Reload only one VM's firewall data
  const reloadVMFirewallRules = async (vm: VMFirewallInfo) => {
    try {
      const [rulesData, optionsData, configResp] = await Promise.all([
        firewallAPI.getVMRules(selectedConnection, vm.node, vm.type, vm.vmid).catch(() => []),
        firewallAPI.getVMOptions(selectedConnection, vm.node, vm.type, vm.vmid).catch(() => null),
        fetch(`/api/v1/connections/${selectedConnection}/guests/${vm.type}/${vm.node}/${vm.vmid}/config`).then(r => r.json()).catch(() => null)
      ])
      
      const nicFirewallEnabled = configResp?.data ? checkNICFirewallEnabled(configResp.data) : false
      
      setVMFirewallData(prev => prev.map(v => 
        v.vmid === vm.vmid ? {
          ...v,
          firewallEnabled: nicFirewallEnabled,
          rules: Array.isArray(rulesData) ? rulesData : [],
          options: optionsData
        } : v
      ))
    } catch (err) {
      console.error('Failed to reload VM firewall rules:', err)
    }
  }
  
  const handleSaveVMRule = async () => {
    if (!editingVMRule || !selectedConnection) return
    
    const { vm, rule, isNew } = editingVMRule
    
    try {
      if (isNew) {
        await firewallAPI.addVMRule(selectedConnection, vm.node, vm.type, vm.vmid, newVMRule)
        setSnackbar({ open: true, message: t('network.ruleCreatedSuccess'), severity: 'success' })
      } else if (rule) {
        await firewallAPI.updateVMRule(selectedConnection, vm.node, vm.type, vm.vmid, rule.pos, newVMRule)
        setSnackbar({ open: true, message: t('network.ruleUpdated'), severity: 'success' })
      }

      setVmRuleDialogOpen(false)
      setEditingVMRule(null)
      reloadVMFirewallRules(vm)
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || t('networkPage.error'), severity: 'error' })
    }
  }
  
  const handleDeleteVMRule = async () => {
    if (!deleteVMRuleConfirm) return
    
    const { vm, pos } = deleteVMRuleConfirm
    
    try {
      await firewallAPI.deleteVMRule(selectedConnection, vm.node, vm.type, vm.vmid, pos)
      setSnackbar({ open: true, message: t('network.ruleDeleted'), severity: 'success' })
      setDeleteVMRuleConfirm(null)
      reloadVMFirewallRules(vm)
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || t('networkPage.error'), severity: 'error' })
    }
  }
  
  const handleToggleVMRuleEnable = async (vm: VMFirewallInfo, rule: firewallAPI.FirewallRule) => {
    try {
      await firewallAPI.updateVMRule(selectedConnection, vm.node, vm.type, vm.vmid, rule.pos, {
        ...rule,
        enable: rule.enable === 1 ? 0 : 1
      })
      setSnackbar({ open: true, message: rule.enable === 1 ? t('network.ruleDisabled') : t('network.ruleEnabled'), severity: 'success' })
      reloadVMFirewallRules(vm)
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || t('networkPage.error'), severity: 'error' })
    }
  }
  
  // Toggle group expansion
  const toggleGroup = (name: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)

      if (next.has(name)) next.delete(name)
      else next.add(name)
      
return next
    })
  }
  
  // Expand/collapse all groups
  const expandAllGroups = () => setExpandedGroups(new Set(securityGroups.map(g => g.group)))
  const collapseAllGroups = () => setExpandedGroups(new Set())
  
  /* ═══════════════════════════════════════════════════════════════════════════
     HANDLERS - ALIASES
  ═══════════════════════════════════════════════════════════════════════════ */
  
  const handleCreateAlias = async () => {
    try {
      await firewallAPI.createAlias(selectedConnection, newAlias)
      setSnackbar({ open: true, message: t('networkPage.aliasCreated'), severity: 'success' })
      setAliasDialogOpen(false)
      setNewAlias({ name: '', cidr: '', comment: '' })
      loadFirewallData()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || t('networkPage.creationError'), severity: 'error' })
    }
  }
  
  const handleUpdateAlias = async () => {
    if (!editingAlias) return

    try {
      await firewallAPI.updateAlias(selectedConnection, editingAlias.name, {
        cidr: editingAlias.cidr,
        comment: editingAlias.comment || ''
      })
      setSnackbar({ open: true, message: t('networkPage.aliasUpdated'), severity: 'success' })
      setEditingAlias(null)
      loadFirewallData()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || t('networkPage.error'), severity: 'error' })
    }
  }
  
  const handleDeleteAlias = async (name: string) => {
    if (!confirm(t('networkPage.deleteAliasConfirm', { name }))) return

    try {
      await firewallAPI.deleteAlias(selectedConnection, name)
      setSnackbar({ open: true, message: t('networkPage.aliasDeleted'), severity: 'success' })
      loadFirewallData()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || t('networkPage.error'), severity: 'error' })
    }
  }
  
  /* ═══════════════════════════════════════════════════════════════════════════
     HANDLERS - IP SETS
  ═══════════════════════════════════════════════════════════════════════════ */
  
  const handleCreateIPSet = async () => {
    try {
      await firewallAPI.createIPSet(selectedConnection, newIPSet)
      setSnackbar({ open: true, message: t('networkPage.ipSetCreated'), severity: 'success' })
      setIPSetDialogOpen(false)
      setNewIPSet({ name: '', comment: '' })
      loadFirewallData()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || t('networkPage.error'), severity: 'error' })
    }
  }
  
  const handleUpdateIPSet = async () => {
    if (!editingIPSet) return

    try {
      // Proxmox ne permet pas de modifier un IPSet, on le recrée
      // Pour l'instant on ne modifie que le commentaire via l'API si disponible
      setSnackbar({ open: true, message: t('networkPage.ipSetUpdated'), severity: 'success' })
      setEditingIPSet(null)
      loadFirewallData()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || t('networkPage.error'), severity: 'error' })
    }
  }
  
  const handleDeleteIPSet = async (name: string) => {
    if (!confirm(t('networkPage.deleteIpSetConfirm', { name }))) return

    try {
      await firewallAPI.deleteIPSet(selectedConnection, name)
      setSnackbar({ open: true, message: t('networkPage.ipSetDeleted'), severity: 'success' })
      loadFirewallData()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || t('networkPage.error'), severity: 'error' })
    }
  }
  
  const handleAddIPSetEntry = async () => {
    if (!ipsetEntryDialog.ipsetName) return

    try {
      await firewallAPI.addIPSetEntry(selectedConnection, ipsetEntryDialog.ipsetName, newIPSetEntry)
      setSnackbar({ open: true, message: t('networkPage.entryAdded'), severity: 'success' })
      setIPSetEntryDialog({ open: false, ipsetName: '' })
      setNewIPSetEntry({ cidr: '', comment: '' })
      loadFirewallData()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || t('networkPage.error'), severity: 'error' })
    }
  }
  
  const handleDeleteIPSetEntry = async (ipsetName: string, cidr: string) => {
    try {
      await firewallAPI.deleteIPSetEntry(selectedConnection, ipsetName, cidr)
      setSnackbar({ open: true, message: t('networkPage.entryDeleted'), severity: 'success' })
      loadFirewallData()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || t('networkPage.error'), severity: 'error' })
    }
  }
  
  /* ═══════════════════════════════════════════════════════════════════════════
     HANDLERS - SECURITY GROUPS
  ═══════════════════════════════════════════════════════════════════════════ */
  
  const handleCreateGroup = async () => {
    try {
      await firewallAPI.createSecurityGroup(selectedConnection, newGroup)
      setSnackbar({ open: true, message: t('networkPage.securityGroupCreated'), severity: 'success' })
      setGroupDialogOpen(false)
      setNewGroup({ group: '', comment: '' })
      loadFirewallData()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || t('networkPage.error'), severity: 'error' })
    }
  }
  
  const handleDeleteGroup = async (name: string) => {
    if (!confirm(t('networkPage.deleteSgConfirm', { name }))) return

    try {
      await firewallAPI.deleteSecurityGroup(selectedConnection, name)
      setSnackbar({ open: true, message: t('networkPage.securityGroupDeleted'), severity: 'success' })
      loadFirewallData()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || t('networkPage.error'), severity: 'error' })
    }
  }
  
  /* ═══════════════════════════════════════════════════════════════════════════
     HANDLERS - RULES
  ═══════════════════════════════════════════════════════════════════════════ */
  
  const handleAddRule = async () => {
    if (!selectedGroup) return

    try {
      await firewallAPI.addSecurityGroupRule(selectedConnection, selectedGroup.group, newRule)
      setSnackbar({ open: true, message: t('network.ruleAdded'), severity: 'success' })
      setRuleDialogOpen(false)
      setNewRule({ type: 'in', action: 'ACCEPT', enable: 1, proto: '', dport: '', source: '', dest: '', comment: '' })
      loadFirewallData()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || t('networkPage.error'), severity: 'error' })
    }
  }

  const handleUpdateRule = async () => {
    if (!editingRule) return

    try {
      await firewallAPI.updateSecurityGroupRule(
        selectedConnection, 
        editingRule.groupName, 
        editingRule.rule.pos,
        {
          type: editingRule.rule.type,
          action: editingRule.rule.action,
          enable: editingRule.rule.enable,
          proto: editingRule.rule.proto || '',
          dport: editingRule.rule.dport || '',
          sport: editingRule.rule.sport || '',
          source: editingRule.rule.source || '',
          dest: editingRule.rule.dest || '',
          comment: editingRule.rule.comment || '',
        }
      )
      setSnackbar({ open: true, message: t('network.ruleUpdated'), severity: 'success' })
      setEditingRule(null)
      loadFirewallData()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || t('networkPage.error'), severity: 'error' })
    }
  }

  const handleToggleRuleEnable = async (groupName: string, rule: firewallAPI.FirewallRule) => {
    try {
      await firewallAPI.updateSecurityGroupRule(selectedConnection, groupName, rule.pos, {
        ...rule,
        enable: rule.enable === 1 ? 0 : 1
      })
      setSnackbar({ open: true, message: rule.enable === 1 ? t('network.ruleDisabled') : t('network.ruleEnabled'), severity: 'success' })
      loadFirewallData()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || t('networkPage.error'), severity: 'error' })
    }
  }

  const handleDeleteRule = async (groupName: string, pos: number) => {
    if (!confirm(t('networkPage.deleteRuleConfirm'))) return

    try {
      await firewallAPI.deleteSecurityGroupRule(selectedConnection, groupName, pos)
      setSnackbar({ open: true, message: t('network.ruleDeleted'), severity: 'success' })
      loadFirewallData()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || t('networkPage.error'), severity: 'error' })
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // DRAG & DROP HANDLERS - SECURITY GROUPS
  // ══════════════════════════════════════════════════════════════════════════════
  
  const handleSGRuleDragStart = (e: React.DragEvent, groupName: string, pos: number) => {
    setSgDragState({ groupName, draggedPos: pos, dragOverPos: null })
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', pos.toString())
    setTimeout(() => {
      (e.currentTarget as HTMLElement).style.opacity = '0.5'
    }, 0)
  }

  const handleSGRuleDragEnd = (e: React.DragEvent) => {
    (e.currentTarget as HTMLElement).style.opacity = '1'
    setSgDragState({ groupName: '', draggedPos: null, dragOverPos: null })
  }

  const handleSGRuleDragOver = (e: React.DragEvent, groupName: string, pos: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'

    if (sgDragState.groupName === groupName && sgDragState.draggedPos !== null && sgDragState.draggedPos !== pos) {
      setSgDragState(prev => ({ ...prev, dragOverPos: pos }))
    }
  }

  const handleSGRuleDragLeave = () => {
    setSgDragState(prev => ({ ...prev, dragOverPos: null }))
  }

  const handleSGRuleDrop = async (e: React.DragEvent, groupName: string, toPos: number) => {
    e.preventDefault()
    const fromPos = sgDragState.draggedPos

    setSgDragState({ groupName: '', draggedPos: null, dragOverPos: null })
    
    if (fromPos !== null && fromPos !== toPos && sgDragState.groupName === groupName) {
      try {
        await firewallAPI.updateSecurityGroupRule(selectedConnection, groupName, fromPos, { moveto: toPos })
        setSnackbar({ open: true, message: t('network.ruleMoved'), severity: 'success' })
        loadFirewallData()
      } catch (err: any) {
        setSnackbar({ open: true, message: err.message || t('networkPage.moveError'), severity: 'error' })
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // DRAG & DROP HANDLERS - VM RULES
  // ══════════════════════════════════════════════════════════════════════════════
  
  const handleVMRuleDragStart = (e: React.DragEvent, vmid: number, pos: number) => {
    setVmDragState({ vmid, draggedPos: pos, dragOverPos: null })
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', pos.toString())
    setTimeout(() => {
      (e.currentTarget as HTMLElement).style.opacity = '0.5'
    }, 0)
  }

  const handleVMRuleDragEnd = (e: React.DragEvent) => {
    (e.currentTarget as HTMLElement).style.opacity = '1'
    setVmDragState({ vmid: 0, draggedPos: null, dragOverPos: null })
  }

  const handleVMRuleDragOver = (e: React.DragEvent, vmid: number, pos: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'

    if (vmDragState.vmid === vmid && vmDragState.draggedPos !== null && vmDragState.draggedPos !== pos) {
      setVmDragState(prev => ({ ...prev, dragOverPos: pos }))
    }
  }

  const handleVMRuleDragLeave = () => {
    setVmDragState(prev => ({ ...prev, dragOverPos: null }))
  }

  const handleVMRuleDrop = async (e: React.DragEvent, vm: VMFirewallInfo, toPos: number) => {
    e.preventDefault()
    const fromPos = vmDragState.draggedPos

    setVmDragState({ vmid: 0, draggedPos: null, dragOverPos: null })
    
    if (fromPos !== null && fromPos !== toPos && vmDragState.vmid === vm.vmid) {
      try {
        await fetch(`/api/v1/firewall/vms/${selectedConnection}/${vm.node}/${vm.type}/${vm.vmid}/rules/${fromPos}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ moveto: toPos })
        })
        setSnackbar({ open: true, message: t('network.ruleMoved'), severity: 'success' })

        // Reload only this VM's rules
        reloadVMFirewallRules(vm)
      } catch (err: any) {
        setSnackbar({ open: true, message: err.message || t('networkPage.moveError'), severity: 'error' })
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // DRAG & DROP HANDLERS - HOST RULES
  // ══════════════════════════════════════════════════════════════════════════════
  
  const handleHostRuleDragStart = (e: React.DragEvent, node: string, pos: number) => {
    setHostDragState({ node, draggedPos: pos, dragOverPos: null })
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', pos.toString())
    setTimeout(() => {
      (e.currentTarget as HTMLElement).style.opacity = '0.5'
    }, 0)
  }

  const handleHostRuleDragEnd = (e: React.DragEvent) => {
    (e.currentTarget as HTMLElement).style.opacity = '1'
    setHostDragState({ node: '', draggedPos: null, dragOverPos: null })
  }

  const handleHostRuleDragOver = (e: React.DragEvent, node: string, pos: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'

    if (hostDragState.node === node && hostDragState.draggedPos !== null && hostDragState.draggedPos !== pos) {
      setHostDragState(prev => ({ ...prev, dragOverPos: pos }))
    }
  }

  const handleHostRuleDragLeave = () => {
    setHostDragState(prev => ({ ...prev, dragOverPos: null }))
  }

  const handleHostRuleDrop = async (e: React.DragEvent, node: string, toPos: number) => {
    e.preventDefault()
    const fromPos = hostDragState.draggedPos

    setHostDragState({ node: '', draggedPos: null, dragOverPos: null })
    
    if (fromPos !== null && fromPos !== toPos && hostDragState.node === node) {
      try {
        await fetch(`/api/v1/firewall/nodes/${selectedConnection}/${node}/rules/${fromPos}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ moveto: toPos })
        })
        setSnackbar({ open: true, message: t('network.ruleMoved'), severity: 'success' })

        // Reload host rules
        loadHostRules()
      } catch (err: any) {
        setSnackbar({ open: true, message: err.message || t('networkPage.moveError'), severity: 'error' })
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // DRAG & DROP HANDLERS - CLUSTER RULES
  // ══════════════════════════════════════════════════════════════════════════════
  
  const handleClusterRuleDragStart = (e: React.DragEvent, pos: number) => {
    setClusterDragState({ draggedPos: pos, dragOverPos: null })
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', pos.toString())
    setTimeout(() => {
      (e.currentTarget as HTMLElement).style.opacity = '0.5'
    }, 0)
  }

  const handleClusterRuleDragEnd = (e: React.DragEvent) => {
    (e.currentTarget as HTMLElement).style.opacity = '1'
    setClusterDragState({ draggedPos: null, dragOverPos: null })
  }

  const handleClusterRuleDragOver = (e: React.DragEvent, pos: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'

    if (clusterDragState.draggedPos !== null && clusterDragState.draggedPos !== pos) {
      setClusterDragState(prev => ({ ...prev, dragOverPos: pos }))
    }
  }

  const handleClusterRuleDragLeave = () => {
    setClusterDragState(prev => ({ ...prev, dragOverPos: null }))
  }

  const handleClusterRuleDrop = async (e: React.DragEvent, toPos: number) => {
    e.preventDefault()
    const fromPos = clusterDragState.draggedPos

    setClusterDragState({ draggedPos: null, dragOverPos: null })
    
    if (fromPos !== null && fromPos !== toPos) {
      try {
        await fetch(`/api/v1/firewall/cluster/${selectedConnection}/rules/${fromPos}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ moveto: toPos })
        })
        setSnackbar({ open: true, message: t('network.ruleMoved'), severity: 'success' })
        loadFirewallData()
      } catch (err: any) {
        setSnackbar({ open: true, message: err.message || t('networkPage.moveError'), severity: 'error' })
      }
    }
  }
  
  // ══════════════════════════════════════════════════════════════════════════════
  // HOST RULES CRUD HANDLERS
  // ══════════════════════════════════════════════════════════════════════════════
  
  const reloadHostRulesForNode = async (node: string) => {
    try {
      const rules = await firewallAPI.getNodeRules(selectedConnection, node)

      setHostRulesByNode(prev => ({
        ...prev,
        [node]: Array.isArray(rules) ? rules : []
      }))
    } catch (err) {
      console.error(`Error reloading rules for node ${node}:`, err)
    }
  }

  const handleAddHostRule = async () => {
    if (!editingHostRule || !selectedConnection) return
    
    try {
      await firewallAPI.addNodeRule(selectedConnection, editingHostRule.node, newHostRule)
      setSnackbar({ open: true, message: t('network.ruleAdded'), severity: 'success' })
      setHostRuleDialogOpen(false)
      setEditingHostRule(null)
      setNewHostRule({ type: 'in', action: 'ACCEPT', enable: 1, proto: '', dport: '', sport: '', source: '', dest: '', macro: '', iface: '', log: 'nolog', comment: '' })
      reloadHostRulesForNode(editingHostRule.node)
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || t('networkPage.error'), severity: 'error' })
    }
  }

  const handleUpdateHostRule = async () => {
    if (!editingHostRule?.rule || !selectedConnection) return
    
    try {
      await fetch(`/api/v1/firewall/nodes/${selectedConnection}/${editingHostRule.node}/rules/${editingHostRule.rule.pos}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newHostRule)
      })
      setSnackbar({ open: true, message: t('network.ruleModified'), severity: 'success' })
      setHostRuleDialogOpen(false)
      setEditingHostRule(null)
      reloadHostRulesForNode(editingHostRule.node)
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || t('networkPage.error'), severity: 'error' })
    }
  }

  const handleDeleteHostRule = async () => {
    if (!deleteHostRuleConfirm || !selectedConnection) return
    const { node, pos } = deleteHostRuleConfirm
    
    try {
      await firewallAPI.deleteNodeRule(selectedConnection, node, pos)
      setSnackbar({ open: true, message: t('network.ruleDeleted'), severity: 'success' })
      setDeleteHostRuleConfirm(null)
      reloadHostRulesForNode(node)
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || t('networkPage.error'), severity: 'error' })
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // CLUSTER RULES CRUD HANDLERS
  // ══════════════════════════════════════════════════════════════════════════════
  
  const reloadClusterRules = async () => {
    if (!selectedConnection) return

    try {
      const rules = await firewallAPI.getClusterRules(selectedConnection)

      setClusterRules(Array.isArray(rules) ? rules : [])
    } catch (err) {
      console.error('Error reloading cluster rules:', err)
    }
  }

  const handleAddClusterRule = async () => {
    if (!selectedConnection) return
    
    try {
      await firewallAPI.addClusterRule(selectedConnection, newClusterRule)
      setSnackbar({ open: true, message: t('network.ruleAdded'), severity: 'success' })
      setClusterRuleDialogOpen(false)
      setEditingClusterRule(null)
      setNewClusterRule({ type: 'in', action: 'ACCEPT', enable: 1, proto: '', dport: '', sport: '', source: '', dest: '', macro: '', iface: '', log: 'nolog', comment: '' })
      reloadClusterRules()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || t('networkPage.error'), severity: 'error' })
    }
  }

  const handleUpdateClusterRule = async () => {
    if (!editingClusterRule?.rule || !selectedConnection) return
    
    try {
      await fetch(`/api/v1/firewall/cluster/${selectedConnection}/rules/${editingClusterRule.rule.pos}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newClusterRule)
      })
      setSnackbar({ open: true, message: t('network.ruleModified'), severity: 'success' })
      setClusterRuleDialogOpen(false)
      setEditingClusterRule(null)
      reloadClusterRules()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || t('networkPage.error'), severity: 'error' })
    }
  }

  const handleDeleteClusterRule = async () => {
    if (!deleteClusterRuleConfirm || !selectedConnection) return
    const { pos } = deleteClusterRuleConfirm
    
    try {
      await firewallAPI.deleteClusterRule(selectedConnection, pos)
      setSnackbar({ open: true, message: t('network.ruleDeleted'), severity: 'success' })
      setDeleteClusterRuleConfirm(null)
      reloadClusterRules()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || t('networkPage.error'), severity: 'error' })
    }
  }
  
  const handleToggleClusterFirewall = async () => {
    try {
      const newEnable = clusterOptions?.enable === 1 ? 0 : 1

      await firewallAPI.updateClusterOptions(selectedConnection, { enable: newEnable })
      setSnackbar({ open: true, message: newEnable === 1 ? t('networkPage.firewallEnabled') : t('networkPage.firewallDisabled'), severity: 'success' })
      loadFirewallData()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || t('networkPage.error'), severity: 'error' })
    }
  }
  
  // Calculate stats
  const totalRules = clusterRules.length + securityGroups.reduce((acc, g) => acc + (g.rules?.length || 0), 0)
  const totalIPSetEntries = ipsets.reduce((acc, s) => acc + (s.members?.length || 0), 0)
  
  const rulesDistribution = [
    { name: 'ACCEPT', value: securityGroups.reduce((acc, g) => acc + (g.rules?.filter(r => r.action === 'ACCEPT').length || 0), 0), color: '#22c55e' },
    { name: 'DROP', value: securityGroups.reduce((acc, g) => acc + (g.rules?.filter(r => r.action === 'DROP').length || 0), 0), color: '#ef4444' },
    { name: 'REJECT', value: securityGroups.reduce((acc, g) => acc + (g.rules?.filter(r => r.action === 'REJECT').length || 0), 0), color: '#f59e0b' },
  ].filter(r => r.value > 0)

  // Monospace style for consistency - use system monospace fonts
  const monoStyle = { fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace', fontSize: 13 }
  
  return (
    <Box sx={{ minHeight: '100vh', p: 3 }}>
      
      {/* Connection Selector - Compact header */}
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel>Cluster</InputLabel>
            <Select value={selectedConnection} label="Cluster" onChange={(e) => {
              setSelectedConnection(e.target.value)
              setVMFirewallData([])
              setExpandedVMs(new Set())
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
      
      {/* Stats Grid - Full Width with CSS Grid */}
      <Box sx={{ 
        display: 'grid', 
        gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, 
        gap: 2, 
        mb: 3,
        width: '100%'
      }}>
        <StatCard icon="ri-shield-check-line" label="Security Groups" value={securityGroups.length} subvalue={t('networkPage.totalRules', { count: totalRules })} color="#22c55e" loading={loading} onClick={() => setActiveTab(2)} />
        <StatCard icon="ri-database-2-line" label="IP Sets" value={ipsets.length} subvalue={`${totalIPSetEntries} ${t('networkPage.entries')}`} color="#3b82f6" loading={loading} onClick={() => setActiveTab(4)} />
        <StatCard icon="ri-price-tag-3-line" label="Aliases" value={aliases.length} subvalue={t('networkPage.namedNetworks')} color="#8b5cf6" loading={loading} onClick={() => setActiveTab(3)} />
        <StatCard icon="ri-cloud-line" label={t('network.clusterRules')} value={clusterRules.length} subvalue={clusterOptions?.enable === 1 ? t('network.firewallActive') : t('network.firewallInactive')} color={clusterOptions?.enable === 1 ? '#06b6d4' : '#94a3b8'} loading={loading} onClick={() => setActiveTab(6)} />
      </Box>
      
      {/* Main Content */}
      <Card sx={{ background: alpha(theme.palette.background.paper, 0.8), backdropFilter: 'blur(10px)', border: `1px solid ${alpha(theme.palette.divider, 0.1)}`, borderRadius: 3 }}>
        <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} variant="scrollable" scrollButtons="auto" sx={{ px: 2, borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
          <Tab icon={<i className="ri-dashboard-line" />} iconPosition="start" label="Overview" sx={{ textTransform: 'none', fontWeight: 600, fontSize: 14 }} />
          <Tab icon={<i className="ri-shield-keyhole-line" />} iconPosition="start" label="Micro-segmentation" sx={{ textTransform: 'none', fontWeight: 600, fontSize: 14 }} />
          <Tab icon={<i className="ri-shield-line" />} iconPosition="start" label="Security Groups" sx={{ textTransform: 'none', fontWeight: 600, fontSize: 14 }} />
          <Tab icon={<i className="ri-price-tag-3-line" />} iconPosition="start" label="Aliases" sx={{ textTransform: 'none', fontWeight: 600, fontSize: 14 }} />
          <Tab icon={<i className="ri-database-2-line" />} iconPosition="start" label="IP Sets" sx={{ textTransform: 'none', fontWeight: 600, fontSize: 14 }} />
          <Tab icon={<i className="ri-computer-line" />} iconPosition="start" label="VM Rules" sx={{ textTransform: 'none', fontWeight: 600, fontSize: 14 }} />
          <Tab icon={<i className="ri-server-line" />} iconPosition="start" label="Host Rules" sx={{ textTransform: 'none', fontWeight: 600, fontSize: 14 }} />
          <Tab 
            icon={<i className="ri-cloud-line" />} 
            iconPosition="start" 
            label="Cluster Rules" 
            sx={{ textTransform: 'none', fontWeight: 600, fontSize: 14 }} 
            disabled={firewallMode === 'standalone'}
          />
          <Tab icon={<i className="ri-settings-3-line" />} iconPosition="start" label="Settings" sx={{ textTransform: 'none', fontWeight: 600, fontSize: 14 }} />
        </Tabs>
        
        {/* ══════════════════════════════════════════════════════════════════════
            TAB 0: OVERVIEW - ZERO TRUST DASHBOARD
        ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === 0 && (
          <Box sx={{ p: 3 }}>
            {/* Row 1: Score + Firewall Status + Distribution + Resources (horizontal layout) */}
            <Paper sx={{ p: 3, border: `1px solid ${alpha(theme.palette.divider, 0.1)}`, mb: 3 }}>
              <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                {/* Security Score - Improved */}
                <Box sx={{ minWidth: 200 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.secondary' }}>
                      {t('networkPage.zeroTrustScore')}
                    </Typography>
                    <Tooltip title={t('networkPage.basedOnCoverage')}>
                      <i className="ri-information-line" style={{ fontSize: 14, color: theme.palette.text.disabled }} />
                    </Tooltip>
                  </Box>
                  {(() => {
                    const vmsWithFirewall = vmFirewallData.filter(v => v.firewallEnabled).length
                    const totalVMs = vmFirewallData.length || 1
                    const vmCoverage = (vmsWithFirewall / totalVMs) * 100
                    const vmsWithSG = vmFirewallData.filter(v => v.rules.some(r => r.type === 'group')).length
                    const sgCoverage = totalVMs > 0 ? (vmsWithSG / totalVMs) * 100 : 0
                    const hasStrictPolicy = currentOptions?.policy_in === 'DROP' || currentOptions?.policy_out === 'DROP'
                    const firewallEnabled = currentOptions?.enable === 1
                    
                    let score = 0

                    if (firewallEnabled) score += 20
                    if (hasStrictPolicy) score += 15
                    score += Math.round(vmCoverage * 0.35)
                    score += Math.round(sgCoverage * 0.30)
                    
                    const scoreColor = score >= 80 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444'
                    const scoreLabel = score >= 80 ? t('networkPage.excellent') : score >= 50 ? t('networkPage.moderate') : t('networkPage.toImprove')
                    
                    return (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                        <Box sx={{ position: 'relative', textAlign: 'center' }}>
                          <Box sx={{ 
                            width: 90, 
                            height: 90, 
                            borderRadius: '50%', 
                            background: `conic-gradient(${scoreColor} ${score * 3.6}deg, ${alpha(theme.palette.divider, 0.2)} 0deg)`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}>
                            <Box sx={{ 
                              width: 72, 
                              height: 72, 
                              borderRadius: '50%', 
                              bgcolor: 'background.paper',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}>
                              <Typography variant="h3" sx={{ fontWeight: 900, color: scoreColor, lineHeight: 1 }}>
                                {score}
                              </Typography>
                            </Box>
                          </Box>
                          <Chip label={scoreLabel} size="small" sx={{ bgcolor: alpha(scoreColor, 0.15), color: scoreColor, fontWeight: 700, mt: 1, height: 20, fontSize: 10 }} />
                        </Box>
                        <Stack spacing={0.5}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <i className={firewallEnabled ? "ri-checkbox-circle-fill" : "ri-close-circle-fill"} style={{ fontSize: 14, color: firewallEnabled ? '#22c55e' : '#ef4444' }} />
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('networkPage.firewallActive')}</Typography>
                          </Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <i className={hasStrictPolicy ? "ri-checkbox-circle-fill" : "ri-close-circle-fill"} style={{ fontSize: 14, color: hasStrictPolicy ? '#22c55e' : '#ef4444' }} />
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('networkPage.strictPolicy')}</Typography>
                          </Box>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('networkPage.protectedPercent', { percent: Math.round(vmCoverage) })}</Typography>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('networkPage.microSegPercent', { percent: Math.round(sgCoverage) })}</Typography>
                        </Stack>
                      </Box>
                    )
                  })()}
                </Box>

                <Divider orientation="vertical" flexItem />

                {/* Firewall Status */}
                <Box sx={{ minWidth: 280 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.secondary', mb: 1.5 }}>
                    {t('networkPage.firewallState')}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                    <Avatar sx={{ width: 40, height: 40, bgcolor: currentOptions?.enable === 1 ? alpha('#22c55e', 0.15) : alpha('#ef4444', 0.15) }}>
                      <i className={currentOptions?.enable === 1 ? "ri-shield-check-line" : "ri-shield-cross-line"} style={{ fontSize: 20, color: currentOptions?.enable === 1 ? '#22c55e' : '#ef4444' }} />
                    </Avatar>
                    <Box sx={{ flex: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                          {firewallMode === 'cluster' ? t('networkPage.firewallCluster') : t('networkPage.firewallHost')}
                        </Typography>
                        <Chip label={firewallMode === 'cluster' ? 'Cluster' : 'Standalone'} size="small" sx={{ height: 18, fontSize: 9, fontWeight: 700, bgcolor: firewallMode === 'cluster' ? alpha('#3b82f6', 0.15) : alpha('#f59e0b', 0.15), color: firewallMode === 'cluster' ? '#3b82f6' : '#f59e0b' }} />
                      </Box>
                      <Typography variant="caption" sx={{ color: currentOptions?.enable === 1 ? '#22c55e' : '#ef4444' }}>
                        {currentOptions?.enable === 1 ? `● ${t('networkPage.active')}` : `○ ${t('networkPage.inactive')}`}
                      </Typography>
                    </Box>
                    <Switch checked={currentOptions?.enable === 1} onChange={handleToggleClusterFirewall} color="success" disabled={!selectedConnection} size="small" />
                  </Box>
                  <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
                    <Chip icon={<i className="ri-arrow-down-line" style={{ fontSize: 10 }} />} label={`IN: ${currentOptions?.policy_in || 'ACCEPT'}`} size="small" sx={{ height: 24, fontSize: 10, fontWeight: 600, bgcolor: currentOptions?.policy_in === 'DROP' ? alpha('#ef4444', 0.15) : alpha('#22c55e', 0.15), color: currentOptions?.policy_in === 'DROP' ? '#ef4444' : '#22c55e' }} />
                    <Chip icon={<i className="ri-arrow-up-line" style={{ fontSize: 10 }} />} label={`OUT: ${currentOptions?.policy_out || 'ACCEPT'}`} size="small" sx={{ height: 24, fontSize: 10, fontWeight: 600, bgcolor: currentOptions?.policy_out === 'DROP' ? alpha('#ef4444', 0.15) : alpha('#22c55e', 0.15), color: currentOptions?.policy_out === 'DROP' ? '#ef4444' : '#22c55e' }} />
                  </Stack>
                  <Stack direction="row" spacing={1}>
                    <Button size="small" variant="outlined" startIcon={<i className="ri-shield-keyhole-line" style={{ fontSize: 14 }} />} onClick={() => setActiveTab(1)} sx={{ fontSize: 11 }}>Micro-segmentation</Button>
                    <Button size="small" variant="outlined" startIcon={<i className="ri-computer-line" style={{ fontSize: 14 }} />} onClick={() => setActiveTab(5)} sx={{ fontSize: 11 }}>VM Rules</Button>
                  </Stack>
                </Box>

                <Divider orientation="vertical" flexItem />

                {/* Rules Distribution */}
                <Box sx={{ minWidth: 200, flex: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.secondary', mb: 1.5 }}>
                    {t('network.rulesDistribution')}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    {rulesDistribution.length > 0 ? (
                      <>
                        <Box sx={{ width: 100, height: 100 }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie data={rulesDistribution} cx="50%" cy="50%" innerRadius={30} outerRadius={45} paddingAngle={2} dataKey="value">
                                {rulesDistribution.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={entry.color} />
                                ))}
                              </Pie>
                            </PieChart>
                          </ResponsiveContainer>
                        </Box>
                        <Stack spacing={0.5}>
                          {rulesDistribution.map((item) => (
                            <Box key={item.name} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: item.color }} />
                              <Typography variant="caption">{item.name}: <strong>{item.value}</strong></Typography>
                            </Box>
                          ))}
                        </Stack>
                      </>
                    ) : (
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('networkPage.noRules')}</Typography>
                    )}
                  </Box>
                </Box>

                <Divider orientation="vertical" flexItem />

                {/* Quick Resources - Horizontal */}
                <Box sx={{ flex: 1, minWidth: 200 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.secondary', mb: 1.5 }}>
                    {t('networkPage.resources')}
                  </Typography>
                  <Stack direction="row" spacing={2}>
                    <Box sx={{ textAlign: 'center', p: 1.5, bgcolor: alpha('#22c55e', 0.05), borderRadius: 1, flex: 1 }}>
                      <Typography variant="h4" sx={{ fontWeight: 900, color: '#22c55e', lineHeight: 1 }}>{securityGroups.length}</Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10 }}>SG</Typography>
                    </Box>
                    <Box sx={{ textAlign: 'center', p: 1.5, bgcolor: alpha('#3b82f6', 0.05), borderRadius: 1, flex: 1 }}>
                      <Typography variant="h4" sx={{ fontWeight: 900, color: '#3b82f6', lineHeight: 1 }}>{totalRules}</Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10 }}>{t('networkPage.rules')}</Typography>
                    </Box>
                    <Box sx={{ textAlign: 'center', p: 1.5, bgcolor: alpha('#8b5cf6', 0.05), borderRadius: 1, flex: 1 }}>
                      <Typography variant="h4" sx={{ fontWeight: 900, color: '#8b5cf6', lineHeight: 1 }}>{aliases.length}</Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10 }}>Aliases</Typography>
                    </Box>
                    <Box sx={{ textAlign: 'center', p: 1.5, bgcolor: alpha('#f59e0b', 0.05), borderRadius: 1, flex: 1 }}>
                      <Typography variant="h4" sx={{ fontWeight: 900, color: '#f59e0b', lineHeight: 1 }}>{ipsets.length}</Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10 }}>IP Sets</Typography>
                    </Box>
                  </Stack>
                </Box>
              </Box>
            </Paper>

            {/* Row 2: VM Coverage - Full Width */}
            <Paper sx={{ p: 3, border: `1px solid ${alpha(theme.palette.divider, 0.1)}`, mb: 3 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.secondary' }}>
                    {t('networkPage.vmFirewallCoverage')}
                  </Typography>
                  {loadingVMRules && (
                    <Chip label={t('networkPage.loading')} size="small" sx={{ height: 20, fontSize: 10 }} />
                  )}
                </Box>
                <Button size="small" onClick={() => setActiveTab(5)} endIcon={<i className="ri-arrow-right-line" />}>
                  {t('networkPage.viewDetails')}
                </Button>
              </Box>
              
              {loadingVMRules ? (
                <Box sx={{ py: 3 }}>
                  <LinearProgress />
                </Box>
              ) : (
              (() => {
                const protected_ = vmFirewallData.filter(v => v.firewallEnabled).length
                const unprotected = vmFirewallData.filter(v => !v.firewallEnabled).length
                const withRules = vmFirewallData.filter(v => v.rules.length > 0).length
                const withSG = vmFirewallData.filter(v => v.rules.some(r => r.type === 'group')).length
                const total = vmFirewallData.length || 1
                
                return (
                  <Box sx={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Stack direction="row" spacing={2}>
                      <Box sx={{ textAlign: 'center', p: 2.5, bgcolor: alpha('#22c55e', 0.05), borderRadius: 2, minWidth: 100 }}>
                        <Typography variant="h2" sx={{ fontWeight: 900, color: '#22c55e', lineHeight: 1 }}>{protected_}</Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('networkPage.protectedLabel')}</Typography>
                      </Box>
                      <Box sx={{ textAlign: 'center', p: 2.5, bgcolor: alpha('#ef4444', 0.05), borderRadius: 2, minWidth: 100 }}>
                        <Typography variant="h2" sx={{ fontWeight: 900, color: '#ef4444', lineHeight: 1 }}>{unprotected}</Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('networkPage.unprotectedLabel')}</Typography>
                      </Box>
                      <Box sx={{ textAlign: 'center', p: 2.5, bgcolor: alpha('#3b82f6', 0.05), borderRadius: 2, minWidth: 100 }}>
                        <Typography variant="h2" sx={{ fontWeight: 900, color: '#3b82f6', lineHeight: 1 }}>{withRules}</Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('networkPage.withRulesLabel')}</Typography>
                      </Box>
                      <Box sx={{ textAlign: 'center', p: 2.5, bgcolor: alpha('#8b5cf6', 0.05), borderRadius: 2, minWidth: 100 }}>
                        <Typography variant="h2" sx={{ fontWeight: 900, color: '#8b5cf6', lineHeight: 1 }}>{withSG}</Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('networkPage.withSgLabel')}</Typography>
                      </Box>
                    </Stack>
                    
                    <Box sx={{ flex: 1, minWidth: 300 }}>
                      <Box sx={{ mb: 2 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                          <Typography variant="body2" sx={{ color: 'text.secondary' }}>{t('networkPage.protectionRate')}</Typography>
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>{Math.round((protected_ / total) * 100)}%</Typography>
                        </Box>
                        <LinearProgress variant="determinate" value={(protected_ / total) * 100} sx={{ height: 10, borderRadius: 5, bgcolor: alpha('#ef4444', 0.15), '& .MuiLinearProgress-bar': { bgcolor: '#22c55e', borderRadius: 5 } }} />
                      </Box>
                      <Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                          <Typography variant="body2" sx={{ color: 'text.secondary' }}>{t('networkPage.microSegmentation')}</Typography>
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>{Math.round((withSG / total) * 100)}%</Typography>
                        </Box>
                        <LinearProgress variant="determinate" value={(withSG / total) * 100} sx={{ height: 10, borderRadius: 5, bgcolor: alpha(theme.palette.divider, 0.2), '& .MuiLinearProgress-bar': { bgcolor: '#8b5cf6', borderRadius: 5 } }} />
                      </Box>
                    </Box>
                  </Box>
                )
              })())}
            </Paper>

            {/* Row 3: Security Groups - Full Width */}
            <Paper sx={{ p: 3, border: `1px solid ${alpha(theme.palette.divider, 0.1)}`, mb: 3 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.secondary' }}>
                  Security Groups
                </Typography>
                <Button size="small" onClick={() => setActiveTab(2)} endIcon={<i className="ri-arrow-right-line" />}>
                  {t('networkPage.manage')}
                </Button>
              </Box>
              
              {firewallMode === 'cluster' ? (
                securityGroups.length > 0 ? (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {securityGroups.map((group, index) => {
                      const color = getGroupColor(index)
                      const isIsolation = group.group.startsWith('sg-base-')

                      
return (
                        <Chip
                          key={group.group}
                          icon={isIsolation ? <i className="ri-lock-line" style={{ fontSize: 12 }} /> : undefined}
                          label={
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <code style={{ background: 'transparent', fontSize: 11, color: 'inherit' }}>{group.group}</code>
                              <Box component="span" sx={{ bgcolor: alpha(color, 0.3), color: color, px: 0.5, borderRadius: 0.5, fontSize: 10, fontWeight: 700, ml: 0.5 }}>
                                {group.rules?.length || 0}
                              </Box>
                            </Box>
                          }
                          size="small"
                          onClick={() => { setActiveTab(2); setExpandedGroups(new Set([group.group])) }}
                          sx={{ cursor: 'pointer', borderLeft: `3px solid ${color}`, borderRadius: 1, height: 28, bgcolor: isIsolation ? alpha('#8b5cf6', 0.05) : 'transparent', '&:hover': { bgcolor: alpha(color, 0.1) } }}
                        />
                      )
                    })}
                  </Box>
                ) : (
                  <Box sx={{ textAlign: 'center', py: 2 }}>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>{t('networkPage.noSecurityGroup')}</Typography>
                    <Button size="small" sx={{ mt: 1 }} onClick={() => setGroupDialogOpen(true)}>{t('networkPage.createGroup')}</Button>
                  </Box>
                )
              ) : (
                <Box sx={{ p: 2, bgcolor: alpha('#f59e0b', 0.05), borderRadius: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <i className="ri-information-line" style={{ fontSize: 16, color: '#f59e0b' }} />
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {t('networkPage.sgNotAvailableStandalone')}
                    </Typography>
                  </Box>
                </Box>
              )}
            </Paper>

            {/* Row 4: Recommendations - Full Width */}
            <Paper sx={{ p: 3, border: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.secondary', mb: 2 }}>
                {t('network.zeroTrustRecommendations')}
              </Typography>

              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                {(() => {
                  const recommendations = []

                  if (currentOptions?.enable !== 1) {
                    recommendations.push({
                      severity: 'error',
                      icon: 'ri-shield-cross-line',
                      title: t('security.firewall') + ' ' + t('common.disabled').toLowerCase(),
                      description: t('network.activateFirewall'),
                      action: t('common.enabled'),
                      onClick: handleToggleClusterFirewall
                    })
                  }

                  if (currentOptions?.policy_in !== 'DROP') {
                    recommendations.push({
                      severity: 'warning',
                      icon: 'ri-arrow-down-line',
                      title: 'Policy IN permissive',
                      description: t('network.switchToDropZeroTrust'),
                      action: t('microseg.configure'),
                      onClick: () => setActiveTab(6)
                    })
                  }

                  const unprotectedVMs = vmFirewallData.filter(v => !v.firewallEnabled)

                  if (unprotectedVMs.length > 0) {
                    recommendations.push({
                      severity: 'warning',
                      icon: 'ri-computer-line',
                      title: t('network.vmsWithDisabledFirewall', { count: unprotectedVMs.length }),
                      description: t('network.enableFirewallVms'),
                      action: t('common.view') + ' VMs',
                      onClick: () => setActiveTab(5)
                    })
                  }

                  const vmsWithoutSG = vmFirewallData.filter(v => v.firewallEnabled && !v.rules.some(r => r.type === 'group'))

                  if (vmsWithoutSG.length > 0 && firewallMode === 'cluster') {
                    recommendations.push({
                      severity: 'info',
                      icon: 'ri-shield-keyhole-line',
                      title: `${vmsWithoutSG.length} VMs without micro-segmentation`,
                      description: t('microseg.clickVmToIsolate'),
                      action: t('microseg.configure'),
                      onClick: () => setActiveTab(1)
                    })
                  }

                  if (recommendations.length === 0) {
                    recommendations.push({
                      severity: 'success',
                      icon: 'ri-checkbox-circle-line',
                      title: t('backups.ok'),
                      description: t('network.infrastructureZeroTrustCompliant'),
                      action: null,
                      onClick: null
                    })
                  }
                  
                  return recommendations.map((rec, idx) => (
                    <Box 
                      key={idx}
                      sx={{ 
                        p: 2, 
                        borderRadius: 1.5,
                        flex: '1 1 300px',
                        bgcolor: alpha(rec.severity === 'error' ? '#ef4444' : rec.severity === 'warning' ? '#f59e0b' : rec.severity === 'success' ? '#22c55e' : '#3b82f6', 0.05),
                        border: `1px solid ${alpha(rec.severity === 'error' ? '#ef4444' : rec.severity === 'warning' ? '#f59e0b' : rec.severity === 'success' ? '#22c55e' : '#3b82f6', 0.2)}`,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 2
                      }}
                    >
                      <Avatar sx={{ width: 36, height: 36, bgcolor: alpha(rec.severity === 'error' ? '#ef4444' : rec.severity === 'warning' ? '#f59e0b' : rec.severity === 'success' ? '#22c55e' : '#3b82f6', 0.15) }}>
                        <i className={rec.icon} style={{ fontSize: 18, color: rec.severity === 'error' ? '#ef4444' : rec.severity === 'warning' ? '#f59e0b' : rec.severity === 'success' ? '#22c55e' : '#3b82f6' }} />
                      </Avatar>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{rec.title}</Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{rec.description}</Typography>
                      </Box>
                      {rec.action && (
                        <Button size="small" variant="outlined" onClick={rec.onClick} sx={{ flexShrink: 0 }}>
                          {rec.action}
                        </Button>
                      )}
                    </Box>
                  ))
                })()}
              </Box>
            </Paper>
          </Box>
        )}
        {/* ══════════════════════════════════════════════════════════════════════
            TAB 1: MICRO-SEGMENTATION
        ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === 1 && selectedConnection && (
          <MicrosegmentationTab connectionId={selectedConnection} />
        )}
        {activeTab === 1 && !selectedConnection && (
          <Box sx={{ p: 3, textAlign: 'center' }}>
            <Typography color="text.secondary">{t('network.selectConnectionMicroseg')}</Typography>
          </Box>
        )}
        
        {/* ══════════════════════════════════════════════════════════════════════
            TAB 2: SECURITY GROUPS
        ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === 2 && (
          <Box sx={{ p: 3 }}>
            {firewallMode === 'standalone' ? (

              // Standalone mode - Security Groups not available
              <Box sx={{ textAlign: 'center', py: 6 }}>
                <Avatar sx={{ width: 80, height: 80, bgcolor: alpha('#f59e0b', 0.15), mx: 'auto', mb: 3 }}>
                  <i className="ri-shield-line" style={{ fontSize: 40, color: '#f59e0b' }} />
                </Avatar>
                <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>{t('network.securityGroupsNotAvailable')}</Typography>
                <Typography variant="body1" sx={{ color: 'text.secondary', maxWidth: 500, mx: 'auto', mb: 3 }}>
                  {t('network.securityGroupsClusterFeature')}
                </Typography>
                <Box sx={{ p: 3, bgcolor: alpha(theme.palette.divider, 0.05), borderRadius: 2, maxWidth: 600, mx: 'auto' }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>{t('network.availableAlternatives')}</Typography>
                  <Stack spacing={1.5} alignItems="flex-start">
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Avatar sx={{ width: 32, height: 32, bgcolor: alpha('#8b5cf6', 0.15) }}>
                        <i className="ri-price-tag-3-line" style={{ fontSize: 16, color: '#8b5cf6' }} />
                      </Avatar>
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>Aliases</Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('network.aliasesDescription')}</Typography>
                      </Box>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Avatar sx={{ width: 32, height: 32, bgcolor: alpha('#f59e0b', 0.15) }}>
                        <i className="ri-database-2-line" style={{ fontSize: 16, color: '#f59e0b' }} />
                      </Avatar>
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>IP Sets</Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('network.ipSetsDescription')}</Typography>
                      </Box>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Avatar sx={{ width: 32, height: 32, bgcolor: alpha('#22c55e', 0.15) }}>
                        <i className="ri-computer-line" style={{ fontSize: 16, color: '#22c55e' }} />
                      </Avatar>
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{t('network.vmCtRules')}</Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('network.vmCtRulesDescription')}</Typography>
                      </Box>
                    </Box>
                  </Stack>
                </Box>
              </Box>
            ) : (

              // Cluster mode - Show Security Groups
              <>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>Security Groups</Typography>
                    <Chip label={t('network.groupsAndRules', { groups: securityGroups.length, rules: totalRules })} size="small" />
                  </Box>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button size="small" variant="outlined" onClick={expandAllGroups}>{t('common.expandAll')}</Button>
                    <Button size="small" variant="outlined" onClick={collapseAllGroups}>{t('common.collapseAll')}</Button>
                    <Button variant="contained" startIcon={<i className="ri-add-line" />} onClick={() => setGroupDialogOpen(true)} disabled={!selectedConnection}>
                      {t('network.newGroup')}
                    </Button>
                  </Box>
                </Box>
                
                <Stack spacing={1}>
                  {securityGroups.map((group) => (
                    <Paper key={group.group} sx={{ border: `1px solid ${alpha(theme.palette.divider, 0.1)}`, overflow: 'hidden' }}>
                      {/* Group Header */}
                      <Box 
                        sx={{ 
                          p: 2, 
                          display: 'flex', 
                          justifyContent: 'space-between', 
                          alignItems: 'center', 
                          cursor: 'pointer',
                          bgcolor: expandedGroups.has(group.group) ? alpha(theme.palette.primary.main, 0.05) : 'transparent',
                          '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.03) }
                        }}
                        onClick={() => toggleGroup(group.group)}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <i className={expandedGroups.has(group.group) ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} style={{ fontSize: 20 }} />
                          <Avatar sx={{ width: 32, height: 32, bgcolor: alpha(theme.palette.primary.main, 0.15) }}>
                            <i className="ri-shield-line" style={{ fontSize: 16, color: theme.palette.primary.main }} />
                          </Avatar>
                          <Box>
                            <code style={{ background: 'transparent', fontSize: 14, fontWeight: 600, color: 'inherit' }}>{group.group}</code>
                            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>{group.comment || t('network.noDescription')}</Typography>
                          </Box>
                        </Box>
                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                          <Chip label={t('networkPage.rulesCount', { count: group.rules?.length || 0 })} size="small" />
                          <Button size="small" startIcon={<i className="ri-add-line" />} onClick={() => { setSelectedGroup(group); setRuleDialogOpen(true) }}>
                            {t('networkPage.rule')}
                          </Button>
                          <IconButton size="small" color="error" onClick={() => handleDeleteGroup(group.group)}>
                            <i className="ri-delete-bin-line" />
                          </IconButton>
                        </Box>
                  </Box>
                  
                  {/* Rules Table */}
                  <Collapse in={expandedGroups.has(group.group)}>
                    {group.rules && group.rules.length > 0 ? (
                      <TableContainer>
                        <Table size="small">
                          <TableHead>
                            <TableRow sx={{ bgcolor: alpha(theme.palette.background.default, 0.5) }}>
                              <TableCell sx={{ fontWeight: 700, width: 30, p: 0.5 }}></TableCell>
                              <TableCell sx={{ fontWeight: 700, width: 35 }}>#</TableCell>
                              <TableCell sx={{ fontWeight: 700, width: 60 }}>Active</TableCell>
                              <TableCell sx={{ fontWeight: 700, width: 60 }}>Type</TableCell>
                              <TableCell sx={{ fontWeight: 700, width: 90 }}>Action</TableCell>
                              <TableCell sx={{ fontWeight: 700 }}>Source</TableCell>
                              <TableCell sx={{ fontWeight: 700 }}>Destination</TableCell>
                              <TableCell sx={{ fontWeight: 700, width: 70 }}>Proto</TableCell>
                              <TableCell sx={{ fontWeight: 700, width: 80 }}>Port</TableCell>
                              <TableCell sx={{ fontWeight: 700 }}>{t('networkPage.comment')}</TableCell>
                              <TableCell sx={{ width: 80 }}></TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {group.rules.map((rule, idx) => {
                              const isDragging = sgDragState.groupName === group.group && sgDragState.draggedPos === rule.pos
                              const isDragOver = sgDragState.groupName === group.group && sgDragState.dragOverPos === rule.pos

                              
return (
                                <TableRow 
                                  key={idx} 
                                  hover
                                  draggable
                                  onDragStart={(e) => handleSGRuleDragStart(e, group.group, rule.pos)}
                                  onDragEnd={handleSGRuleDragEnd}
                                  onDragOver={(e) => handleSGRuleDragOver(e, group.group, rule.pos)}
                                  onDragLeave={handleSGRuleDragLeave}
                                  onDrop={(e) => handleSGRuleDrop(e, group.group, rule.pos)}
                                  sx={{
                                    cursor: 'grab',
                                    opacity: isDragging ? 0.5 : 1,
                                    borderTop: isDragOver ? `2px solid ${theme.palette.primary.main}` : undefined,
                                    '&:active': { cursor: 'grabbing' }
                                  }}
                                >
                                  <TableCell sx={{ p: 0.5, cursor: 'grab' }}>
                                    <i className="ri-draggable" style={{ fontSize: 14, color: theme.palette.text.disabled }} />
                                  </TableCell>
                                  <TableCell sx={{ color: 'text.secondary', fontSize: 11, p: 0.5 }}>
                                    {rule.pos}
                                  </TableCell>
                                  <TableCell sx={{ p: 0.5 }}>
                                    <Switch 
                                      checked={rule.enable === 1} 
                                      onChange={() => handleToggleRuleEnable(group.group, rule)}
                                      size="small"
                                      color="success"
                                    />
                                  </TableCell>
                                  <TableCell sx={{ p: 0.5 }}>
                                    <Chip label={rule.type?.toUpperCase() || 'IN'} size="small" variant="outlined" sx={{ fontSize: 10, height: 20 }} />
                                  </TableCell>
                                  <TableCell sx={{ p: 0.5 }}>
                                    <ActionChip action={rule.action || 'ACCEPT'} />
                                  </TableCell>
                                  <TableCell sx={{ ...monoStyle, color: rule.source ? 'text.primary' : 'text.disabled', fontSize: 11, p: 0.5 }}>
                                    {rule.source || 'any'}
                                  </TableCell>
                                  <TableCell sx={{ ...monoStyle, color: rule.dest ? 'text.primary' : 'text.disabled', fontSize: 11, p: 0.5 }}>
                                    {rule.dest || 'any'}
                                  </TableCell>
                                  <TableCell sx={{ ...monoStyle, fontSize: 11, p: 0.5 }}>
                                    {rule.proto || 'any'}
                                  </TableCell>
                                  <TableCell sx={{ ...monoStyle, color: rule.dport ? 'text.primary' : 'text.disabled', fontSize: 11, p: 0.5 }}>
                                    {rule.dport || '-'}
                                  </TableCell>
                                  <TableCell sx={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', p: 0.5 }}>
                                    <Tooltip title={rule.comment || ''}>
                                      <span style={{ fontSize: 11 }}>{rule.comment || '-'}</span>
                                    </Tooltip>
                                  </TableCell>
                                  <TableCell sx={{ p: 0.5 }}>
                                    <Box sx={{ display: 'flex', gap: 0 }}>
                                      <Tooltip title={t('networkPage.edit')}>
                                        <IconButton size="small" onClick={() => setEditingRule({ groupName: group.group, rule, index: idx })}>
                                          <i className="ri-edit-line" style={{ fontSize: 14 }} />
                                        </IconButton>
                                      </Tooltip>
                                      <Tooltip title="Supprimer">
                                        <IconButton size="small" color="error" onClick={() => handleDeleteRule(group.group, rule.pos)}>
                                          <i className="ri-delete-bin-line" style={{ fontSize: 14 }} />
                                        </IconButton>
                                      </Tooltip>
                                    </Box>
                                  </TableCell>
                                </TableRow>
                              )
                            })}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    ) : (
                      <Box sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>
                        <Typography variant="body2">{t('networkPage.noRules')}</Typography>
                        <Button size="small" sx={{ mt: 1 }} onClick={() => { setSelectedGroup(group); setRuleDialogOpen(true) }}>
                          {t('networkPage.addRule')}
                        </Button>
                      </Box>
                    )}
                  </Collapse>
                </Paper>
              ))}

              {securityGroups.length === 0 && !loading && (
                <Paper sx={{ p: 4, textAlign: 'center', border: `1px dashed ${alpha(theme.palette.divider, 0.3)}` }}>
                  <i className="ri-shield-line" style={{ fontSize: 48, opacity: 0.3 }} />
                  <Typography variant="body1" sx={{ mt: 2, color: 'text.secondary' }}>{t('networkPage.noSecurityGroup')}</Typography>
                  <Button sx={{ mt: 2 }} onClick={() => setGroupDialogOpen(true)}>{t('networkPage.createGroup')}</Button>
                </Paper>
              )}
            </Stack>
              </>
            )}
          </Box>
        )}
        
        {/* ══════════════════════════════════════════════════════════════════════
            TAB 3: ALIASES
        ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === 3 && (
          <Box sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>Aliases</Typography>
                <Chip label={`${aliases.length} aliases`} size="small" />
              </Box>
              <Button variant="contained" startIcon={<i className="ri-add-line" />} onClick={() => setAliasDialogOpen(true)} disabled={!selectedConnection}>
                {t('networkPage.new')}
              </Button>
            </Box>

            <TableContainer component={Paper} sx={{ border: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: alpha(theme.palette.background.default, 0.5) }}>
                    <TableCell sx={{ fontWeight: 700 }}>{t('common.name')}</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>CIDR</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Description</TableCell>
                    <TableCell sx={{ width: 100 }}></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {aliases.map((alias) => (
                    <TableRow key={alias.name} hover>
                      <TableCell><code style={{ fontSize: 13, background: 'transparent', color: 'inherit' }}>{alias.name}</code></TableCell>
                      <TableCell><code style={{ fontSize: 13, background: 'transparent', color: 'inherit' }}>{alias.cidr}</code></TableCell>
                      <TableCell sx={{ color: 'text.secondary', fontSize: 13 }}>{alias.comment || '-'}</TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                          <Tooltip title={t('networkPage.edit')}>
                            <IconButton size="small" onClick={() => setEditingAlias({ ...alias })}>
                              <i className="ri-edit-line" style={{ fontSize: 16 }} />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Supprimer">
                            <IconButton size="small" color="error" onClick={() => handleDeleteAlias(alias.name)}>
                              <i className="ri-delete-bin-line" style={{ fontSize: 16 }} />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))}
                  {aliases.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
                        {t('networkPage.noAliasConfiguredLabel')}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}
        
        {/* ══════════════════════════════════════════════════════════════════════
            TAB 4: IP SETS
        ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === 4 && (
          <Box sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>IP Sets</Typography>
                <Chip label={t('networkPage.setsAndEntries', { sets: ipsets.length, entries: totalIPSetEntries })} size="small" />
              </Box>
              <Button variant="contained" startIcon={<i className="ri-add-line" />} onClick={() => setIPSetDialogOpen(true)} disabled={!selectedConnection}>
                {t('networkPage.new')}
              </Button>
            </Box>

            <Stack spacing={2}>
              {ipsets.map((ipset) => (
                <Paper key={ipset.name} sx={{ border: `1px solid ${alpha(theme.palette.divider, 0.1)}`, overflow: 'hidden' }}>
                  <Box sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', bgcolor: alpha(theme.palette.background.default, 0.3) }}>
                    <Box>
                      <code style={{ background: 'transparent', fontSize: 14, fontWeight: 600, color: 'inherit' }}>{ipset.name}</code>
                      <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 12, display: 'block' }}>{ipset.comment || t('networkPage.noDescription')}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      <Chip label={`${ipset.members?.length || 0} ${t('networkPage.entries')}`} size="small" />
                      <Button size="small" startIcon={<i className="ri-add-line" />} onClick={() => setIPSetEntryDialog({ open: true, ipsetName: ipset.name })}>
                        {t('networkPage.add')}
                      </Button>
                      <Tooltip title={t('networkPage.edit')}>
                        <IconButton size="small" onClick={() => setEditingIPSet({ name: ipset.name, comment: ipset.comment || '' })}>
                          <i className="ri-edit-line" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('networkPage.delete')}>
                        <IconButton size="small" color="error" onClick={() => handleDeleteIPSet(ipset.name)}>
                          <i className="ri-delete-bin-line" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </Box>
                  {ipset.members && ipset.members.length > 0 && (
                    <Box sx={{ p: 2, pt: 1 }}>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {ipset.members.map((member, idx) => (
                          <Chip
                            key={idx}
                            label={<code style={{ background: 'transparent', fontSize: 12, color: 'inherit' }}>{member.cidr}</code>}
                            size="small"
                            variant="outlined"
                            onDelete={() => handleDeleteIPSetEntry(ipset.name, member.cidr)}
                            sx={{ '& .MuiChip-deleteIcon': { fontSize: 16 } }}
                          />
                        ))}
                      </Box>
                    </Box>
                  )}
                </Paper>
              ))}
              {ipsets.length === 0 && !loading && (
                <Paper sx={{ p: 4, textAlign: 'center', border: `1px dashed ${alpha(theme.palette.divider, 0.3)}` }}>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>{t('networkPage.noIpSetConfigured')}</Typography>
                </Paper>
              )}
            </Stack>
          </Box>
        )}
        
        {/* ══════════════════════════════════════════════════════════════════════
            TAB 5: VM RULES
        ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === 5 && (
          <Box sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>{t('networkPage.firewallRulesPerVm')}</Typography>
                <Chip
                  label={t('networkPage.vmsProtectedCount', { filtered: filteredVMData.length, total: vmFirewallData.length, protected: vmFirewallData.filter(v => v.firewallEnabled).length })}
                  size="small"
                />
              </Box>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <TextField
                  size="small"
                  placeholder={t('networkPage.searchVm')}
                  value={vmSearchQuery}
                  onChange={(e) => setVmSearchQuery(e.target.value)}
                  InputProps={{
                    startAdornment: <i className="ri-search-line" style={{ marginRight: 8, opacity: 0.5 }} />,
                    sx: { fontSize: 13 }
                  }}
                  sx={{ width: 200 }}
                />
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setExpandedVMs(new Set(filteredVMData.map(v => v.vmid)))}
                >
                  {t('networkPage.expandAllVms')}
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setExpandedVMs(new Set())}
                >
                  {t('networkPage.collapseAllVms')}
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<i className="ri-refresh-line" />}
                  onClick={loadVMFirewallData}
                  disabled={loadingVMRules}
                >
                  {t('networkPage.refresh')}
                </Button>
              </Box>
            </Box>

            {loadingVMRules ? (
              <Box sx={{ py: 4 }}>
                <LinearProgress />
                <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', mt: 2 }}>
                  {t('networkPage.loadingFirewallRules')}
                </Typography>
              </Box>
            ) : (
              <Stack spacing={1}>
                {filteredVMData.map((vm) => (
                  <Paper key={vm.vmid} sx={{ border: `1px solid ${alpha(theme.palette.divider, 0.1)}`, overflow: 'hidden' }}>
                    {/* VM Header */}
                    <Box 
                      sx={{ 
                        p: 2, 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center', 
                        cursor: 'pointer',
                        bgcolor: expandedVMs.has(vm.vmid) ? alpha(theme.palette.primary.main, 0.05) : 'transparent',
                        '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.03) }
                      }}
                      onClick={() => toggleVM(vm.vmid)}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <i className={expandedVMs.has(vm.vmid) ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} style={{ fontSize: 20 }} />
                        <Avatar sx={{ 
                          width: 32, 
                          height: 32, 
                          bgcolor: vm.firewallEnabled ? alpha('#22c55e', 0.15) : alpha(theme.palette.divider, 0.3)
                        }}>
                          <i 
                            className={vm.type === 'qemu' ? 'ri-computer-line' : 'ri-instance-line'} 
                            style={{ fontSize: 16, color: vm.firewallEnabled ? '#22c55e' : theme.palette.text.secondary }} 
                          />
                        </Avatar>
                        <Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>{vm.name}</Typography>
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>({vm.vmid})</Typography>
                          </Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{vm.node}</Typography>
                            <Chip 
                              label={vm.type.toUpperCase()} 
                              size="small" 
                              sx={{ height: 16, fontSize: 9, fontWeight: 700 }} 
                            />
                            <Chip 
                              label={vm.status} 
                              size="small" 
                              sx={{ 
                                height: 16, 
                                fontSize: 9,
                                bgcolor: vm.status === 'running' ? alpha('#22c55e', 0.15) : alpha('#ef4444', 0.15),
                                color: vm.status === 'running' ? '#22c55e' : '#ef4444'
                              }} 
                            />
                          </Box>
                        </Box>
                      </Box>
                      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                        <Chip
                          icon={<i className={vm.firewallEnabled ? 'ri-shield-check-line' : 'ri-shield-line'} style={{ fontSize: 12 }} />}
                          label={vm.firewallEnabled ? t('networkPage.firewallActiveLabel') : t('networkPage.firewallInactiveLabel')}
                          size="small"
                          sx={{
                            bgcolor: vm.firewallEnabled ? alpha('#22c55e', 0.15) : alpha(theme.palette.divider, 0.3),
                            color: vm.firewallEnabled ? '#22c55e' : 'text.secondary'
                          }}
                        />
                        <Chip label={t('networkPage.rulesCount', { count: vm.rules.length })} size="small" />
                        <Tooltip title={t('networkPage.addRule')}>
                          <IconButton
                            size="small"
                            color="primary"
                            onClick={() => openVMRuleDialog(vm)}
                          >
                            <i className="ri-add-line" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </Box>
                    
                    {/* VM Rules Collapse */}
                    <Collapse in={expandedVMs.has(vm.vmid)}>
                      <Box sx={{ p: 2, borderTop: `1px solid ${alpha(theme.palette.divider, 0.1)}`, bgcolor: alpha(theme.palette.divider, 0.02) }}>
                        {/* Options */}
                        {vm.options && (
                          <Box sx={{ mb: 2, p: 1.5, bgcolor: alpha(theme.palette.divider, 0.05), borderRadius: 1 }}>
                            <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', display: 'block', mb: 1 }}>Options</Typography>
                            <Stack direction="row" spacing={2}>
                              <Chip 
                                label={`IN: ${vm.options.policy_in || 'ACCEPT'}`} 
                                size="small"
                                sx={{ 
                                  height: 22,
                                  fontSize: 11,
                                  fontWeight: 600, 
                                  bgcolor: vm.options.policy_in === 'DROP' ? alpha('#ef4444', 0.15) : alpha('#22c55e', 0.15), 
                                  color: vm.options.policy_in === 'DROP' ? '#ef4444' : '#22c55e'
                                }} 
                              />
                              <Chip 
                                label={`OUT: ${vm.options.policy_out || 'ACCEPT'}`} 
                                size="small"
                                sx={{ 
                                  height: 22,
                                  fontSize: 11,
                                  fontWeight: 600, 
                                  bgcolor: vm.options.policy_out === 'DROP' ? alpha('#ef4444', 0.15) : alpha('#22c55e', 0.15), 
                                  color: vm.options.policy_out === 'DROP' ? '#ef4444' : '#22c55e'
                                }} 
                              />
                            </Stack>
                          </Box>
                        )}
                        
                        {/* Rules Table */}
                        {vm.rules.length > 0 ? (
                          <TableContainer>
                            <Table size="small">
                              <TableHead>
                                <TableRow>
                                  <TableCell sx={{ fontWeight: 700, fontSize: 11, width: 30, p: 0.5 }}></TableCell>
                                  <TableCell sx={{ fontWeight: 700, fontSize: 11, width: 35 }}>#</TableCell>
                                  <TableCell sx={{ fontWeight: 700, fontSize: 11, width: 50 }}>Actif</TableCell>
                                  <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Type</TableCell>
                                  <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Action</TableCell>
                                  <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Proto</TableCell>
                                  <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Source</TableCell>
                                  <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Dest</TableCell>
                                  <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Port</TableCell>
                                  <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Commentaire</TableCell>
                                  <TableCell sx={{ fontWeight: 700, fontSize: 11, width: 80 }}>Actions</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {vm.rules.map((rule, idx) => {
                                  const isDragging = vmDragState.vmid === vm.vmid && vmDragState.draggedPos === rule.pos
                                  const isDragOver = vmDragState.vmid === vm.vmid && vmDragState.dragOverPos === rule.pos

                                  
return (
                                    <TableRow 
                                      key={idx} 
                                      hover
                                      draggable
                                      onDragStart={(e) => handleVMRuleDragStart(e, vm.vmid, rule.pos)}
                                      onDragEnd={handleVMRuleDragEnd}
                                      onDragOver={(e) => handleVMRuleDragOver(e, vm.vmid, rule.pos)}
                                      onDragLeave={handleVMRuleDragLeave}
                                      onDrop={(e) => handleVMRuleDrop(e, vm, rule.pos)}
                                      sx={{ 
                                        opacity: isDragging ? 0.5 : (rule.enable === 0 ? 0.5 : 1),
                                        cursor: 'grab',
                                        borderTop: isDragOver ? `2px solid ${theme.palette.primary.main}` : undefined,
                                        '&:active': { cursor: 'grabbing' }
                                      }}
                                    >
                                      <TableCell sx={{ p: 0.5, cursor: 'grab' }}>
                                        <i className="ri-draggable" style={{ fontSize: 14, color: theme.palette.text.disabled }} />
                                      </TableCell>
                                      <TableCell sx={{ p: 0.5 }}>
                                        <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: 10 }}>{rule.pos}</Typography>
                                      </TableCell>
                                      <TableCell sx={{ p: 0.5 }}>
                                        <Switch
                                          checked={rule.enable === 1}
                                          onChange={() => handleToggleVMRuleEnable(vm, rule)}
                                          size="small"
                                          color="success"
                                        />
                                      </TableCell>
                                      <TableCell sx={{ p: 0.5 }}>
                                        <Chip 
                                          label={rule.type?.toUpperCase() || '-'} 
                                          size="small"
                                          sx={{ 
                                            height: 18, 
                                            fontSize: 9, 
                                            fontWeight: 700,
                                            bgcolor: rule.type === 'in' ? alpha('#3b82f6', 0.15) : rule.type === 'out' ? alpha('#8b5cf6', 0.15) : alpha('#f59e0b', 0.15),
                                            color: rule.type === 'in' ? '#3b82f6' : rule.type === 'out' ? '#8b5cf6' : '#f59e0b'
                                          }} 
                                        />
                                      </TableCell>
                                      <TableCell sx={{ p: 0.5 }}>
                                        <Chip 
                                          label={rule.action || '-'} 
                                          size="small"
                                          sx={{ 
                                            height: 18, 
                                            fontSize: 9, 
                                            fontWeight: 700,
                                            bgcolor: rule.action === 'ACCEPT' ? alpha('#22c55e', 0.15) : alpha('#ef4444', 0.15),
                                            color: rule.action === 'ACCEPT' ? '#22c55e' : '#ef4444'
                                          }} 
                                        />
                                      </TableCell>
                                      <TableCell sx={{ p: 0.5 }}>
                                        <code style={{ fontSize: 10 }}>{rule.macro || rule.proto || 'any'}</code>
                                      </TableCell>
                                      <TableCell sx={{ p: 0.5 }}>
                                        <code style={{ fontSize: 10 }}>{rule.source || '-'}</code>
                                      </TableCell>
                                      <TableCell sx={{ p: 0.5 }}>
                                        <code style={{ fontSize: 10 }}>{rule.dest || '-'}</code>
                                      </TableCell>
                                      <TableCell sx={{ p: 0.5 }}>
                                        <code style={{ fontSize: 10 }}>{rule.dport || '-'}</code>
                                      </TableCell>
                                      <TableCell sx={{ p: 0.5 }}>
                                        <Tooltip title={rule.comment || ''}>
                                          <Typography variant="caption" sx={{ color: 'text.secondary', maxWidth: 100, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10 }}>
                                            {rule.comment || '-'}
                                          </Typography>
                                        </Tooltip>
                                      </TableCell>
                                      <TableCell sx={{ p: 0.5 }}>
                                        <Box sx={{ display: 'flex', gap: 0 }}>
                                          <Tooltip title={t('networkPage.edit')}>
                                            <IconButton size="small" onClick={() => openVMRuleDialog(vm, rule)}>
                                              <i className="ri-edit-line" style={{ fontSize: 14 }} />
                                            </IconButton>
                                          </Tooltip>
                                          <Tooltip title="Supprimer">
                                            <IconButton size="small" color="error" onClick={() => setDeleteVMRuleConfirm({ vm, pos: rule.pos })}>
                                              <i className="ri-delete-bin-line" style={{ fontSize: 14 }} />
                                            </IconButton>
                                          </Tooltip>
                                        </Box>
                                      </TableCell>
                                    </TableRow>
                                  )
                                })}
                              </TableBody>
                            </Table>
                          </TableContainer>
                        ) : (
                          <Box sx={{ py: 2, textAlign: 'center' }}>
                            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                              {t('networkPage.noRuleConfigured')}
                            </Typography>
                            <Button
                              size="small"
                              startIcon={<i className="ri-add-line" />}
                              onClick={() => openVMRuleDialog(vm)}
                              sx={{ mt: 1 }}
                            >
                              {t('networkPage.addRule')}
                            </Button>
                          </Box>
                        )}
                      </Box>
                    </Collapse>
                  </Paper>
                ))}

                {filteredVMData.length === 0 && !loadingVMRules && (
                  <Paper sx={{ p: 4, textAlign: 'center', border: `1px dashed ${alpha(theme.palette.divider, 0.3)}` }}>
                    <i className="ri-computer-line" style={{ fontSize: 48, opacity: 0.3 }} />
                    <Typography variant="body1" sx={{ mt: 2, color: 'text.secondary' }}>{t('networkPage.noVmFoundLabel')}</Typography>
                    <Button sx={{ mt: 2 }} onClick={loadVMFirewallData}>{t('common.loadVms')}</Button>
                  </Paper>
                )}
              </Stack>
            )}
          </Box>
        )}
        
        {/* ══════════════════════════════════════════════════════════════════════
            TAB 7: CLUSTER RULES
        ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === 7 && (
          <Box sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>{t('network.clusterRules')}</Typography>
                <Chip
                  label={clusterRules.length > 1
                    ? t('networkPage.rulesAndActiveCount', { count: clusterRules.length, active: clusterRules.filter(r => r.enable !== 0).length })
                    : t('networkPage.ruleAndActiveCount', { count: clusterRules.length, active: clusterRules.filter(r => r.enable !== 0).length })}
                  size="small"
                />
              </Box>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<i className="ri-refresh-line" />}
                  onClick={reloadClusterRules}
                >
                  {t('networkPage.refresh')}
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<i className="ri-add-line" />}
                  onClick={() => {
                    setEditingClusterRule({ rule: null, isNew: true })
                    setNewClusterRule({ type: 'in', action: 'ACCEPT', enable: 1, proto: '', dport: '', sport: '', source: '', dest: '', macro: '', iface: '', log: 'nolog', comment: '' })
                    setClusterRuleDialogOpen(true)
                  }}
                >
                  {t('networkPage.add')}
                </Button>
              </Box>
            </Box>

            {clusterRules.length > 0 ? (
              <Paper sx={{ border: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700, width: 30 }}></TableCell>
                      <TableCell sx={{ fontWeight: 700, width: 35, fontSize: 11 }}>#</TableCell>
                      <TableCell sx={{ fontWeight: 700, width: 50, fontSize: 11 }}>{t('common.active')}</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Type</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Action</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Proto</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Source</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Dest</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Port</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>{t('networkPage.comment')}</TableCell>
                      <TableCell sx={{ fontWeight: 700, width: 80, fontSize: 11 }}>{t('common.actions')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {clusterRules.map((rule, index) => {
                      const isDragging = clusterDragState.draggedPos === rule.pos
                      const isDragOver = clusterDragState.dragOverPos === rule.pos
                      const isGroupRule = rule.type === 'group'
                      
                      return (
                        <TableRow 
                          key={index} 
                          hover
                          draggable
                          onDragStart={(e) => handleClusterRuleDragStart(e, rule.pos)}
                          onDragEnd={handleClusterRuleDragEnd}
                          onDragOver={(e) => handleClusterRuleDragOver(e, rule.pos)}
                          onDragLeave={handleClusterRuleDragLeave}
                          onDrop={(e) => handleClusterRuleDrop(e, rule.pos)}
                          sx={{ 
                            opacity: isDragging ? 0.5 : 1,
                            bgcolor: isDragOver ? alpha(theme.palette.primary.main, 0.1) : 'transparent',
                            cursor: 'grab',
                            '&:active': { cursor: 'grabbing' }
                          }}
                        >
                          <TableCell sx={{ p: 0.5 }}>
                            <i className="ri-draggable" style={{ fontSize: 14, color: theme.palette.text.disabled, cursor: 'grab' }} />
                          </TableCell>
                          <TableCell sx={{ fontSize: 11 }}>{rule.pos}</TableCell>
                          <TableCell>
                            <Chip 
                              label={rule.enable === 0 ? 'Off' : 'On'} 
                              size="small" 
                              sx={{ 
                                height: 18, fontSize: 9,
                                bgcolor: rule.enable === 0 ? alpha('#888', 0.15) : alpha('#22c55e', 0.15),
                                color: rule.enable === 0 ? '#888' : '#22c55e'
                              }} 
                            />
                          </TableCell>
                          <TableCell>
                            <Chip 
                              label={isGroupRule ? 'GROUP' : rule.type?.toUpperCase() || '-'}
                              size="small"
                              sx={{ 
                                height: 18, fontSize: 9,
                                bgcolor: isGroupRule ? alpha('#8b5cf6', 0.15) : rule.type === 'in' ? alpha('#3b82f6', 0.15) : alpha('#ec4899', 0.15),
                                color: isGroupRule ? '#8b5cf6' : rule.type === 'in' ? '#3b82f6' : '#ec4899'
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            {isGroupRule ? (
                              <Chip 
                                icon={<i className="ri-shield-line" style={{ fontSize: 10 }} />}
                                label={rule.action} 
                                size="small" 
                                sx={{ height: 20, fontSize: 10, fontWeight: 600, bgcolor: alpha('#8b5cf6', 0.15), color: '#8b5cf6', '& .MuiChip-icon': { color: '#8b5cf6' } }} 
                              />
                            ) : (
                              <Chip 
                                label={rule.action || '-'} 
                                size="small" 
                                sx={{ 
                                  height: 18, fontSize: 9,
                                  bgcolor: rule.action === 'ACCEPT' ? alpha('#22c55e', 0.15) : rule.action === 'DROP' ? alpha('#ef4444', 0.15) : alpha('#f59e0b', 0.15),
                                  color: rule.action === 'ACCEPT' ? '#22c55e' : rule.action === 'DROP' ? '#ef4444' : '#f59e0b'
                                }}
                              />
                            )}
                          </TableCell>
                          <TableCell sx={{ fontSize: 11 }}>{isGroupRule ? '-' : (rule.proto || 'any')}</TableCell>
                          <TableCell sx={{ fontSize: 11 }}><code>{isGroupRule ? '-' : (rule.source || 'any')}</code></TableCell>
                          <TableCell sx={{ fontSize: 11 }}><code>{isGroupRule ? '-' : (rule.dest || 'any')}</code></TableCell>
                          <TableCell sx={{ fontSize: 11 }}>{isGroupRule ? '-' : (rule.dport || '-')}</TableCell>
                          <TableCell sx={{ fontSize: 11, color: 'text.secondary' }}>{rule.comment || '-'}</TableCell>
                          <TableCell>
                            <Stack direction="row" spacing={0.5}>
                              <Tooltip title="Éditer">
                                <IconButton 
                                  size="small" 
                                  onClick={() => {
                                    setEditingClusterRule({ rule, isNew: false })
                                    setNewClusterRule({
                                      type: rule.type || 'in',
                                      action: rule.action || 'ACCEPT',
                                      enable: rule.enable ?? 1,
                                      proto: rule.proto || '',
                                      dport: rule.dport || '',
                                      sport: rule.sport || '',
                                      source: rule.source || '',
                                      dest: rule.dest || '',
                                      macro: rule.macro || '',
                                      iface: rule.iface || '',
                                      log: rule.log || 'nolog',
                                      comment: rule.comment || ''
                                    })
                                    setClusterRuleDialogOpen(true)
                                  }}
                                >
                                  <i className="ri-pencil-line" style={{ fontSize: 14 }} />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="Supprimer">
                                <IconButton 
                                  size="small" 
                                  color="error"
                                  onClick={() => setDeleteClusterRuleConfirm({ pos: rule.pos })}
                                >
                                  <i className="ri-delete-bin-line" style={{ fontSize: 14 }} />
                                </IconButton>
                              </Tooltip>
                            </Stack>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </Paper>
            ) : (
              <Paper sx={{ p: 4, textAlign: 'center', border: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
                <Avatar sx={{ width: 64, height: 64, bgcolor: alpha('#3b82f6', 0.15), mx: 'auto', mb: 2 }}>
                  <i className="ri-cloud-line" style={{ fontSize: 32, color: '#3b82f6' }} />
                </Avatar>
                <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>{t('networkPage.noClusterRuleTitle')}</Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
                  {t('networkPage.clusterRulesDescription')}
                </Typography>
                <Button
                  variant="contained"
                  startIcon={<i className="ri-add-line" />}
                  onClick={() => {
                    setEditingClusterRule({ rule: null, isNew: true })
                    setNewClusterRule({ type: 'in', action: 'ACCEPT', enable: 1, proto: '', dport: '', sport: '', source: '', dest: '', macro: '', iface: '', log: 'nolog', comment: '' })
                    setClusterRuleDialogOpen(true)
                  }}
                >
                  {t('networkPage.createARule')}
                </Button>
              </Paper>
            )}
          </Box>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
            TAB 6: HOST RULES
        ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === 6 && (
          <Box sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>{t('network.hostRules')}</Typography>
                <Chip
                  label={t('networkPage.hostsAndRulesCount', { filtered: filteredHosts.length, total: nodesList.length, rules: Object.values(hostRulesByNode).reduce((acc, r) => acc + r.length, 0) })}
                  size="small"
                />
              </Box>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <TextField
                  size="small"
                  placeholder={t('networkPage.searchHost')}
                  value={hostSearchQuery}
                  onChange={(e) => setHostSearchQuery(e.target.value)}
                  InputProps={{
                    startAdornment: <i className="ri-search-line" style={{ marginRight: 8, opacity: 0.5 }} />,
                    sx: { fontSize: 13 }
                  }}
                  sx={{ width: 180 }}
                />
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setExpandedHosts(new Set(filteredHosts))}
                >
                  {t('common.expandAll')}
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setExpandedHosts(new Set())}
                >
                  {t('common.collapseAll')}
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<i className={loadingHostRules ? "ri-loader-4-line" : "ri-refresh-line"} />}
                  onClick={() => loadHostRules()}
                  disabled={loadingHostRules}
                >
                  {t('networkPage.refresh')}
                </Button>
              </Box>
            </Box>

            {loadingHostRules ? (
              <Box sx={{ py: 4 }}>
                <LinearProgress />
                <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', mt: 2 }}>
                  {t('networkPage.loadingHostRules')}
                </Typography>
              </Box>
            ) : filteredHosts.length > 0 ? (
              <Stack spacing={1}>
                {filteredHosts.map((node) => {
                  const rules = hostRulesByNode[node] || []
                  const isExpanded = expandedHosts.has(node)
                  
                  return (
                    <Paper key={node} sx={{ border: `1px solid ${alpha(theme.palette.divider, 0.1)}`, overflow: 'hidden' }}>
                      {/* Host Header */}
                      <Box 
                        sx={{ 
                          p: 2, 
                          display: 'flex', 
                          justifyContent: 'space-between', 
                          alignItems: 'center', 
                          cursor: 'pointer',
                          bgcolor: isExpanded ? alpha(theme.palette.primary.main, 0.05) : 'transparent',
                          '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.03) }
                        }}
                        onClick={() => setExpandedHosts(prev => {
                          const newSet = new Set(prev)

                          if (newSet.has(node)) newSet.delete(node)
                          else newSet.add(node)
                          
return newSet
                        })}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <i className={isExpanded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} style={{ fontSize: 20 }} />
                          <Avatar sx={{ width: 32, height: 32, bgcolor: alpha('#f59e0b', 0.15) }}>
                            <i className="ri-server-line" style={{ fontSize: 16, color: '#f59e0b' }} />
                          </Avatar>
                          <Box>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>{node}</Typography>
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                              {rules.length > 1
                                ? t('networkPage.rulesAndActiveCount', { count: rules.length, active: rules.filter(r => r.enable !== 0).length })
                                : t('networkPage.ruleAndActiveCount', { count: rules.length, active: rules.filter(r => r.enable !== 0).length })}
                            </Typography>
                          </Box>
                        </Box>
                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                          <Chip label={t('networkPage.rulesCount', { count: rules.length })} size="small" />
                          <Tooltip title={t('networkPage.addRule')}>
                            <IconButton
                              size="small"
                              color="primary"
                              onClick={() => {
                                setEditingHostRule({ node, rule: null, isNew: true })
                                setNewHostRule({ type: 'in', action: 'ACCEPT', enable: 1, proto: '', dport: '', sport: '', source: '', dest: '', macro: '', iface: '', log: 'nolog', comment: '' })
                                setHostRuleDialogOpen(true)
                              }}
                            >
                              <i className="ri-add-line" />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      </Box>

                      {/* Host Rules Collapse */}
                      <Collapse in={isExpanded}>
                        <Box sx={{ p: 2, borderTop: `1px solid ${alpha(theme.palette.divider, 0.1)}`, bgcolor: alpha(theme.palette.divider, 0.02) }}>
                          {rules.length > 0 ? (
                            <TableContainer>
                              <Table size="small">
                                <TableHead>
                                  <TableRow>
                                    <TableCell sx={{ fontWeight: 700, fontSize: 11, width: 30, p: 0.5 }}></TableCell>
                                    <TableCell sx={{ fontWeight: 700, fontSize: 11, width: 35 }}>#</TableCell>
                                    <TableCell sx={{ fontWeight: 700, fontSize: 11, width: 50 }}>{t('common.active')}</TableCell>
                                    <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Type</TableCell>
                                    <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Action</TableCell>
                                    <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Proto</TableCell>
                                    <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Source</TableCell>
                                    <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Dest</TableCell>
                                    <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Port</TableCell>
                                    <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Commentaire</TableCell>
                                    <TableCell sx={{ fontWeight: 700, fontSize: 11, width: 80 }}>Actions</TableCell>
                                  </TableRow>
                                </TableHead>
                                <TableBody>
                                  {rules.map((rule, idx) => {
                                    const isDragging = hostDragState.node === node && hostDragState.draggedPos === rule.pos
                                    const isDragOver = hostDragState.node === node && hostDragState.dragOverPos === rule.pos
                                    const isGroupRule = rule.type === 'group'
                                    
                                    return (
                                      <TableRow 
                                        key={idx} 
                                        hover
                                        draggable
                                        onDragStart={(e) => handleHostRuleDragStart(e, node, rule.pos)}
                                        onDragEnd={handleHostRuleDragEnd}
                                        onDragOver={(e) => handleHostRuleDragOver(e, node, rule.pos)}
                                        onDragLeave={handleHostRuleDragLeave}
                                        onDrop={(e) => handleHostRuleDrop(e, node, rule.pos)}
                                        sx={{ 
                                          opacity: isDragging ? 0.5 : 1,
                                          bgcolor: isDragOver ? alpha(theme.palette.primary.main, 0.1) : 'transparent',
                                          cursor: 'grab',
                                          '&:active': { cursor: 'grabbing' }
                                        }}
                                      >
                                        <TableCell sx={{ p: 0.5 }}>
                                          <i className="ri-draggable" style={{ fontSize: 14, color: theme.palette.text.disabled, cursor: 'grab' }} />
                                        </TableCell>
                                        <TableCell sx={{ fontSize: 11 }}>{rule.pos}</TableCell>
                                        <TableCell>
                                          <Chip 
                                            label={rule.enable === 0 ? 'Off' : 'On'} 
                                            size="small" 
                                            sx={{ 
                                              height: 18, fontSize: 9,
                                              bgcolor: rule.enable === 0 ? alpha('#888', 0.15) : alpha('#22c55e', 0.15),
                                              color: rule.enable === 0 ? '#888' : '#22c55e'
                                            }} 
                                          />
                                        </TableCell>
                                        <TableCell>
                                          <Chip 
                                            label={isGroupRule ? 'GROUP' : rule.type?.toUpperCase() || '-'}
                                            size="small"
                                            sx={{ 
                                              height: 18, fontSize: 9,
                                              bgcolor: isGroupRule ? alpha('#8b5cf6', 0.15) : rule.type === 'in' ? alpha('#3b82f6', 0.15) : alpha('#ec4899', 0.15),
                                              color: isGroupRule ? '#8b5cf6' : rule.type === 'in' ? '#3b82f6' : '#ec4899'
                                            }}
                                          />
                                        </TableCell>
                                        <TableCell>
                                          {isGroupRule ? (
                                            <Chip 
                                              icon={<i className="ri-shield-line" style={{ fontSize: 10 }} />}
                                              label={rule.action} 
                                              size="small" 
                                              sx={{ height: 20, fontSize: 10, fontWeight: 600, bgcolor: alpha('#8b5cf6', 0.15), color: '#8b5cf6', '& .MuiChip-icon': { color: '#8b5cf6' } }} 
                                            />
                                          ) : (
                                            <Chip 
                                              label={rule.action || '-'} 
                                              size="small" 
                                              sx={{ 
                                                height: 18, fontSize: 9,
                                                bgcolor: rule.action === 'ACCEPT' ? alpha('#22c55e', 0.15) : rule.action === 'DROP' ? alpha('#ef4444', 0.15) : alpha('#f59e0b', 0.15),
                                                color: rule.action === 'ACCEPT' ? '#22c55e' : rule.action === 'DROP' ? '#ef4444' : '#f59e0b'
                                              }}
                                            />
                                          )}
                                        </TableCell>
                                        <TableCell sx={{ fontSize: 11 }}>{isGroupRule ? '-' : (rule.proto || 'any')}</TableCell>
                                        <TableCell sx={{ fontSize: 11 }}><code>{isGroupRule ? '-' : (rule.source || 'any')}</code></TableCell>
                                        <TableCell sx={{ fontSize: 11 }}><code>{isGroupRule ? '-' : (rule.dest || 'any')}</code></TableCell>
                                        <TableCell sx={{ fontSize: 11 }}>{isGroupRule ? '-' : (rule.dport || '-')}</TableCell>
                                        <TableCell sx={{ fontSize: 11, color: 'text.secondary' }}>{rule.comment || '-'}</TableCell>
                                        <TableCell>
                                          <Stack direction="row" spacing={0.5}>
                                            <Tooltip title="Éditer">
                                              <IconButton 
                                                size="small" 
                                                onClick={() => {
                                                  setEditingHostRule({ node, rule, isNew: false })
                                                  setNewHostRule({
                                                    type: rule.type || 'in',
                                                    action: rule.action || 'ACCEPT',
                                                    enable: rule.enable ?? 1,
                                                    proto: rule.proto || '',
                                                    dport: rule.dport || '',
                                                    sport: rule.sport || '',
                                                    source: rule.source || '',
                                                    dest: rule.dest || '',
                                                    macro: rule.macro || '',
                                                    iface: rule.iface || '',
                                                    log: rule.log || 'nolog',
                                                    comment: rule.comment || ''
                                                  })
                                                  setHostRuleDialogOpen(true)
                                                }}
                                              >
                                                <i className="ri-pencil-line" style={{ fontSize: 14 }} />
                                              </IconButton>
                                            </Tooltip>
                                            <Tooltip title="Supprimer">
                                              <IconButton 
                                                size="small" 
                                                color="error"
                                                onClick={() => setDeleteHostRuleConfirm({ node, pos: rule.pos })}
                                              >
                                                <i className="ri-delete-bin-line" style={{ fontSize: 14 }} />
                                              </IconButton>
                                            </Tooltip>
                                          </Stack>
                                        </TableCell>
                                      </TableRow>
                                    )
                                  })}
                                </TableBody>
                              </Table>
                            </TableContainer>
                          ) : (
                            <Box sx={{ textAlign: 'center', py: 2 }}>
                              <Typography variant="body2" sx={{ color: 'text.secondary' }}>{t('networkPage.noRuleConfigured')}</Typography>
                            </Box>
                          )}
                        </Box>
                      </Collapse>
                    </Paper>
                  )
                })}
              </Stack>
            ) : (
              <Paper sx={{ p: 4, textAlign: 'center', border: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
                <Avatar sx={{ width: 64, height: 64, bgcolor: alpha('#f59e0b', 0.15), mx: 'auto', mb: 2 }}>
                  <i className="ri-server-line" style={{ fontSize: 32, color: '#f59e0b' }} />
                </Avatar>
                <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>{t('networkPage.noHostFoundTitle')}</Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {hostSearchQuery ? t('networkPage.noResultsForSearch') : t('networkPage.cannotGetNodeList')}
                </Typography>
              </Paper>
            )}
          </Box>
        )}
        
        {/* ══════════════════════════════════════════════════════════════════════
            TAB 8: SETTINGS
        ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === 8 && (
          <Box sx={{ p: 3 }}>
            <Grid container spacing={3}>
              <Grid size={{ xs: 12, md: 6 }}>
                <Paper sx={{ p: 3, border: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
                  <Typography variant="h6" sx={{ fontWeight: 700, mb: 3 }}>{t('networkPage.firewallConfiguration')}</Typography>
                  <Stack spacing={2}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{t('security.firewall')}</Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('networkPage.enablesClusterRules')}</Typography>
                      </Box>
                      <Switch checked={clusterOptions?.enable === 1} onChange={handleToggleClusterFirewall} color="success" disabled={!selectedConnection} />
                    </Box>
                    <Divider />
                    <FormControl fullWidth size="small">
                      <InputLabel>Policy IN</InputLabel>
                      <Select value={clusterOptions?.policy_in || 'ACCEPT'} label="Policy IN" disabled>
                        <MenuItem value="ACCEPT">ACCEPT</MenuItem>
                        <MenuItem value="DROP">DROP</MenuItem>
                        <MenuItem value="REJECT">REJECT</MenuItem>
                      </Select>
                    </FormControl>
                    <FormControl fullWidth size="small">
                      <InputLabel>Policy OUT</InputLabel>
                      <Select value={clusterOptions?.policy_out || 'ACCEPT'} label="Policy OUT" disabled>
                        <MenuItem value="ACCEPT">ACCEPT</MenuItem>
                        <MenuItem value="DROP">DROP</MenuItem>
                        <MenuItem value="REJECT">REJECT</MenuItem>
                      </Select>
                    </FormControl>
                  </Stack>
                </Paper>
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <Paper sx={{ p: 3, border: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
                  <Typography variant="h6" sx={{ fontWeight: 700, mb: 3 }}>{t('monitoring.statistics')}</Typography>
                  <Stack spacing={1}>
                    {[
                      { label: 'Security Groups', value: securityGroups.length },
                      { label: t('networkPage.totalRulesLabel'), value: totalRules },
                      { label: t('networkPage.clusterRulesLabel'), value: clusterRules.length },
                      { label: 'Aliases', value: aliases.length },
                      { label: 'IP Sets', value: ipsets.length },
                      { label: t('networkPage.ipSetEntriesLabel'), value: totalIPSetEntries },
                    ].map((stat, i) => (
                      <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', p: 1.5, bgcolor: alpha(theme.palette.background.default, 0.5), borderRadius: 1 }}>
                        <Typography variant="body2">{stat.label}</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>{stat.value}</Typography>
                      </Box>
                    ))}
                  </Stack>
                </Paper>
              </Grid>
            </Grid>
          </Box>
        )}
      </Card>
      
      {/* ══════════════════════════════════════════════════════════════════════
          DIALOGS
      ══════════════════════════════════════════════════════════════════════ */}
      
      {/* Create Alias */}
      <Dialog open={aliasDialogOpen} onClose={() => setAliasDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('networkPage.createAliasTitle')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 2 }}>
            <TextField label={t('common.name')} value={newAlias.name} onChange={(e) => setNewAlias({ ...newAlias, name: e.target.value })} placeholder="net-mgmt" fullWidth size="small" InputProps={{ sx: monoStyle }} />
            <TextField label="CIDR" value={newAlias.cidr} onChange={(e) => setNewAlias({ ...newAlias, cidr: e.target.value })} placeholder="10.99.99.0/24" fullWidth size="small" InputProps={{ sx: monoStyle }} />
            <TextField label={t('common.description')} value={newAlias.comment} onChange={(e) => setNewAlias({ ...newAlias, comment: e.target.value })} fullWidth size="small" />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAliasDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={handleCreateAlias} disabled={!newAlias.name || !newAlias.cidr}>{t('networkPage.createButton')}</Button>
        </DialogActions>
      </Dialog>

      {/* Edit Alias */}
      <Dialog open={!!editingAlias} onClose={() => setEditingAlias(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('networkPage.editAlias')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 2 }}>
            <TextField label={t('common.name')} value={editingAlias?.name || ''} disabled fullWidth size="small" InputProps={{ sx: monoStyle }} />
            <TextField label="CIDR" value={editingAlias?.cidr || ''} onChange={(e) => setEditingAlias(prev => prev ? { ...prev, cidr: e.target.value } : null)} fullWidth size="small" InputProps={{ sx: monoStyle }} />
            <TextField label={t('common.description')} value={editingAlias?.comment || ''} onChange={(e) => setEditingAlias(prev => prev ? { ...prev, comment: e.target.value } : null)} fullWidth size="small" />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditingAlias(null)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={handleUpdateAlias}>{t('common.save')}</Button>
        </DialogActions>
      </Dialog>

      {/* Create IP Set */}
      <Dialog open={ipsetDialogOpen} onClose={() => setIPSetDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('networkPage.createIpSetTitle')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 2 }}>
            <TextField label={t('common.name')} value={newIPSet.name} onChange={(e) => setNewIPSet({ ...newIPSet, name: e.target.value })} placeholder="trusted-hosts" fullWidth size="small" InputProps={{ sx: monoStyle }} />
            <TextField label={t('common.description')} value={newIPSet.comment} onChange={(e) => setNewIPSet({ ...newIPSet, comment: e.target.value })} fullWidth size="small" />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIPSetDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={handleCreateIPSet} disabled={!newIPSet.name}>{t('networkPage.createButton')}</Button>
        </DialogActions>
      </Dialog>
      
      {/* Edit IP Set */}
      <Dialog open={!!editingIPSet} onClose={() => setEditingIPSet(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('networkPage.editIpSet')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 2 }}>
            <TextField label={t('common.name')} value={editingIPSet?.name || ''} disabled fullWidth size="small" InputProps={{ sx: monoStyle }} />
            <TextField label={t('common.description')} value={editingIPSet?.comment || ''} onChange={(e) => setEditingIPSet(prev => prev ? { ...prev, comment: e.target.value } : null)} fullWidth size="small" />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditingIPSet(null)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={handleUpdateIPSet}>{t('common.save')}</Button>
        </DialogActions>
      </Dialog>

      {/* Add IP Set Entry */}
      <Dialog open={ipsetEntryDialog.open} onClose={() => setIPSetEntryDialog({ open: false, ipsetName: '' })} maxWidth="sm" fullWidth>
        <DialogTitle>{t('networkPage.addToTitle', { name: ipsetEntryDialog.ipsetName })}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 2 }}>
            <TextField label="CIDR" value={newIPSetEntry.cidr} onChange={(e) => setNewIPSetEntry({ ...newIPSetEntry, cidr: e.target.value })} placeholder="10.0.0.0/24" fullWidth size="small" InputProps={{ sx: monoStyle }} />
            <TextField label={t('networkPage.comment')} value={newIPSetEntry.comment} onChange={(e) => setNewIPSetEntry({ ...newIPSetEntry, comment: e.target.value })} fullWidth size="small" />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIPSetEntryDialog({ open: false, ipsetName: '' })}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={handleAddIPSetEntry} disabled={!newIPSetEntry.cidr}>{t('networkPage.add')}</Button>
        </DialogActions>
      </Dialog>

      {/* Create Security Group */}
      <Dialog open={groupDialogOpen} onClose={() => setGroupDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('networkPage.createSgTitle')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 2 }}>
            <TextField label={t('common.name')} value={newGroup.group} onChange={(e) => setNewGroup({ ...newGroup, group: e.target.value })} placeholder="sg-web" fullWidth size="small" InputProps={{ sx: monoStyle }} />
            <TextField label={t('common.description')} value={newGroup.comment} onChange={(e) => setNewGroup({ ...newGroup, comment: e.target.value })} fullWidth size="small" />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGroupDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={handleCreateGroup} disabled={!newGroup.group}>{t('networkPage.createButton')}</Button>
        </DialogActions>
      </Dialog>

      {/* Add Rule */}
      <Dialog open={ruleDialogOpen} onClose={() => setRuleDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{t('networkPage.addRuleToTitle', { name: selectedGroup?.group })}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid size={{ xs: 6, sm: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Type</InputLabel>
                <Select value={newRule.type} label="Type" onChange={(e) => setNewRule({ ...newRule, type: e.target.value })}>
                  <MenuItem value="in">IN</MenuItem>
                  <MenuItem value="out">OUT</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Action</InputLabel>
                <Select value={newRule.action} label="Action" onChange={(e) => setNewRule({ ...newRule, action: e.target.value })}>
                  <MenuItem value="ACCEPT">ACCEPT</MenuItem>
                  <MenuItem value="DROP">DROP</MenuItem>
                  <MenuItem value="REJECT">REJECT</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Protocole</InputLabel>
                <Select value={newRule.proto || ''} label="Protocole" onChange={(e) => setNewRule({ ...newRule, proto: e.target.value })}>
                  <MenuItem value="">Tous</MenuItem>
                  <MenuItem value="tcp">TCP</MenuItem>
                  <MenuItem value="udp">UDP</MenuItem>
                  <MenuItem value="icmp">ICMP</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TextField label="Port dest" value={newRule.dport || ''} onChange={(e) => setNewRule({ ...newRule, dport: e.target.value })} placeholder="22, 80:443" fullWidth size="small" InputProps={{ sx: monoStyle }} />
            </Grid>
            <Grid size={{ xs: 6 }}>
              <TextField label="Source" value={newRule.source || ''} onChange={(e) => setNewRule({ ...newRule, source: e.target.value })} placeholder="any" fullWidth size="small" helperText="CIDR, alias, ou +ipset" InputProps={{ sx: monoStyle }} />
            </Grid>
            <Grid size={{ xs: 6 }}>
              <TextField label="Destination" value={newRule.dest || ''} onChange={(e) => setNewRule({ ...newRule, dest: e.target.value })} placeholder="any" fullWidth size="small" helperText="CIDR, alias, ou +ipset" InputProps={{ sx: monoStyle }} />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField label="Commentaire" value={newRule.comment || ''} onChange={(e) => setNewRule({ ...newRule, comment: e.target.value })} fullWidth size="small" />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRuleDialogOpen(false)}>Annuler</Button>
          <Button variant="contained" onClick={handleAddRule}>Ajouter</Button>
        </DialogActions>
      </Dialog>
      
      {/* Edit Rule */}
      <Dialog open={!!editingRule} onClose={() => setEditingRule(null)} maxWidth="md" fullWidth>
        <DialogTitle>{t('networkPage.editTheRule')}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid size={{ xs: 6, sm: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Type</InputLabel>
                <Select value={editingRule?.rule.type || 'in'} label="Type" onChange={(e) => setEditingRule(prev => prev ? { ...prev, rule: { ...prev.rule, type: e.target.value } } : null)}>
                  <MenuItem value="in">IN</MenuItem>
                  <MenuItem value="out">OUT</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Action</InputLabel>
                <Select value={editingRule?.rule.action || 'ACCEPT'} label="Action" onChange={(e) => setEditingRule(prev => prev ? { ...prev, rule: { ...prev.rule, action: e.target.value } } : null)}>
                  <MenuItem value="ACCEPT">ACCEPT</MenuItem>
                  <MenuItem value="DROP">DROP</MenuItem>
                  <MenuItem value="REJECT">REJECT</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Protocole</InputLabel>
                <Select value={editingRule?.rule.proto || ''} label="Protocole" onChange={(e) => setEditingRule(prev => prev ? { ...prev, rule: { ...prev.rule, proto: e.target.value } } : null)}>
                  <MenuItem value="">Tous</MenuItem>
                  <MenuItem value="tcp">TCP</MenuItem>
                  <MenuItem value="udp">UDP</MenuItem>
                  <MenuItem value="icmp">ICMP</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TextField label="Port dest" value={editingRule?.rule.dport || ''} onChange={(e) => setEditingRule(prev => prev ? { ...prev, rule: { ...prev.rule, dport: e.target.value } } : null)} fullWidth size="small" InputProps={{ sx: monoStyle }} />
            </Grid>
            <Grid size={{ xs: 6 }}>
              <TextField label="Source" value={editingRule?.rule.source || ''} onChange={(e) => setEditingRule(prev => prev ? { ...prev, rule: { ...prev.rule, source: e.target.value } } : null)} fullWidth size="small" InputProps={{ sx: monoStyle }} />
            </Grid>
            <Grid size={{ xs: 6 }}>
              <TextField label="Destination" value={editingRule?.rule.dest || ''} onChange={(e) => setEditingRule(prev => prev ? { ...prev, rule: { ...prev.rule, dest: e.target.value } } : null)} fullWidth size="small" InputProps={{ sx: monoStyle }} />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField label="Commentaire" value={editingRule?.rule.comment || ''} onChange={(e) => setEditingRule(prev => prev ? { ...prev, rule: { ...prev.rule, comment: e.target.value } } : null)} fullWidth size="small" />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditingRule(null)}>Annuler</Button>
          <Button variant="contained" onClick={handleUpdateRule}>Enregistrer</Button>
        </DialogActions>
      </Dialog>
      
      {/* VM Rule Dialog - Style Proxmox amélioré */}
      <Dialog open={vmRuleDialogOpen} onClose={() => setVmRuleDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className="ri-shield-line" style={{ color: theme.palette.primary.main }} />
            {editingVMRule?.isNew ? t('networkPage.addVmRuleTitle') : t('networkPage.editVmRuleTitle')}
            {editingVMRule && (
              <Chip label={`${editingVMRule.vm.name} (${editingVMRule.vm.vmid})`} size="small" sx={{ ml: 1 }} />
            )}
          </Box>
          <IconButton onClick={() => setVmRuleDialogOpen(false)} size="small">
            <i className="ri-close-line" />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Grid container spacing={2.5}>
            {/* Row 1: Direction, Action, Macro, Enable */}
            <Grid size={{ xs: 6, sm: 2.5 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Direction</InputLabel>
                <Select 
                  value={newVMRule.type} 
                  label="Direction" 
                  onChange={(e) => setNewVMRule(prev => ({ ...prev, type: e.target.value }))}
                >
                  <MenuItem value="in">IN</MenuItem>
                  <MenuItem value="out">OUT</MenuItem>
                  <MenuItem value="group">GROUP</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, sm: 2.5 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Action</InputLabel>
                <Select 
                  value={newVMRule.action} 
                  label="Action" 
                  onChange={(e) => setNewVMRule(prev => ({ ...prev, action: e.target.value }))}
                >
                  <MenuItem value="ACCEPT">ACCEPT</MenuItem>
                  <MenuItem value="DROP">DROP</MenuItem>
                  <MenuItem value="REJECT">REJECT</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Macro</InputLabel>
                <Select 
                  value={newVMRule.macro || ''} 
                  label="Macro" 
                  onChange={(e) => setNewVMRule(prev => ({ ...prev, macro: e.target.value, proto: e.target.value ? '' : prev.proto }))}
                >
                  <MenuItem value="">Aucune</MenuItem>
                  <MenuItem value="SSH">SSH</MenuItem>
                  <MenuItem value="HTTP">HTTP</MenuItem>
                  <MenuItem value="HTTPS">HTTPS</MenuItem>
                  <MenuItem value="DNS">DNS</MenuItem>
                  <MenuItem value="Ping">Ping</MenuItem>
                  <MenuItem value="Web">Web (HTTP+HTTPS)</MenuItem>
                  <MenuItem value="SMTP">SMTP</MenuItem>
                  <MenuItem value="FTP">FTP</MenuItem>
                  <MenuItem value="NTP">NTP</MenuItem>
                  <MenuItem value="MySQL">MySQL</MenuItem>
                  <MenuItem value="PostgreSQL">PostgreSQL</MenuItem>
                  <MenuItem value="Redis">Redis</MenuItem>
                  <MenuItem value="Ceph">Ceph</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, sm: 2 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Protocole</InputLabel>
                <Select 
                  value={newVMRule.proto || ''} 
                  label="Protocole" 
                  onChange={(e) => setNewVMRule(prev => ({ ...prev, proto: e.target.value }))}
                  disabled={!!newVMRule.macro}
                >
                  <MenuItem value="">Tous</MenuItem>
                  <MenuItem value="tcp">TCP</MenuItem>
                  <MenuItem value="udp">UDP</MenuItem>
                  <MenuItem value="icmp">ICMP</MenuItem>
                  <MenuItem value="sctp">SCTP</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, sm: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', border: `1px solid ${alpha(theme.palette.divider, 0.3)}`, borderRadius: 1, px: 1 }}>
                <Switch 
                  checked={newVMRule.enable === 1} 
                  onChange={(e) => setNewVMRule(prev => ({ ...prev, enable: e.target.checked ? 1 : 0 }))}
                  color="success"
                  size="small"
                />
                <Typography variant="body2" sx={{ ml: 0.5, fontSize: 13 }}>{t('common.enabled')}</Typography>
              </Box>
            </Grid>
            
            {/* Row 2: Interface, Source, Source port */}
            <Grid size={{ xs: 4, sm: 2 }}>
              <TextField 
                label="Interface" 
                value={newVMRule.iface || ''} 
                onChange={(e) => setNewVMRule(prev => ({ ...prev, iface: e.target.value }))}
                fullWidth 
                size="small" 
                placeholder="net0"
                InputProps={{ sx: { fontFamily: 'monospace', fontSize: 13 } }}
              />
            </Grid>
            <Grid size={{ xs: 8, sm: 5 }}>
              <TextField 
                label="Source" 
                value={newVMRule.source || ''} 
                onChange={(e) => setNewVMRule(prev => ({ ...prev, source: e.target.value }))}
                fullWidth 
                size="small" 
                placeholder="192.168.1.0/24, +ipset, alias"
                InputProps={{ sx: { fontFamily: 'monospace', fontSize: 13 } }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 5 }}>
              <TextField 
                label="Port source" 
                value={newVMRule.sport || ''} 
                onChange={(e) => setNewVMRule(prev => ({ ...prev, sport: e.target.value }))}
                fullWidth 
                size="small" 
                placeholder="80, 1024:65535"
                InputProps={{ sx: { fontFamily: 'monospace', fontSize: 13 } }}
                disabled={!!newVMRule.macro}
              />
            </Grid>
            
            {/* Row 3: Destination, Dest port */}
            <Grid size={{ xs: 12, sm: 7 }}>
              <TextField 
                label="Destination" 
                value={newVMRule.dest || ''} 
                onChange={(e) => setNewVMRule(prev => ({ ...prev, dest: e.target.value }))}
                fullWidth 
                size="small" 
                placeholder="10.0.0.0/8, +ipset, alias"
                InputProps={{ sx: { fontFamily: 'monospace', fontSize: 13 } }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 5 }}>
              <TextField 
                label="Port destination" 
                value={newVMRule.dport || ''} 
                onChange={(e) => setNewVMRule(prev => ({ ...prev, dport: e.target.value }))}
                fullWidth 
                size="small" 
                placeholder="22, 80, 443, 8000:9000"
                InputProps={{ sx: { fontFamily: 'monospace', fontSize: 13 } }}
                disabled={!!newVMRule.macro}
              />
            </Grid>
            
            {/* Row 4: Comment, Log level */}
            <Grid size={{ xs: 12, sm: 9 }}>
              <TextField 
                label="Commentaire" 
                value={newVMRule.comment || ''} 
                onChange={(e) => setNewVMRule(prev => ({ ...prev, comment: e.target.value }))}
                fullWidth 
                size="small" 
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Log level</InputLabel>
                <Select 
                  value={newVMRule.log || 'nolog'} 
                  label="Log level" 
                  onChange={(e) => setNewVMRule(prev => ({ ...prev, log: e.target.value }))}
                >
                  <MenuItem value="nolog">nolog</MenuItem>
                  <MenuItem value="warning">warning</MenuItem>
                  <MenuItem value="info">info</MenuItem>
                  <MenuItem value="debug">debug</MenuItem>
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setVmRuleDialogOpen(false)}>Annuler</Button>
          <Button variant="contained" onClick={handleSaveVMRule} startIcon={<i className="ri-check-line" />}>
            {editingVMRule?.isNew ? 'Ajouter' : 'Enregistrer'}
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* Dialog de confirmation de suppression */}
      <Dialog open={!!deleteVMRuleConfirm} onClose={() => setDeleteVMRuleConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-error-warning-line" style={{ color: theme.palette.error.main, fontSize: 24 }} />
          {t('networkPage.deleteRule')}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {t('networkPage.deleteRuleQuestion')}
          </Typography>
          {deleteVMRuleConfirm && (
            <Box sx={{ mt: 2, p: 1.5, bgcolor: alpha(theme.palette.divider, 0.1), borderRadius: 1 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                VM: <strong>{deleteVMRuleConfirm.vm.name}</strong> ({deleteVMRuleConfirm.vm.vmid}) • Position: <strong>{deleteVMRuleConfirm.pos}</strong>
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteVMRuleConfirm(null)}>{t('common.cancel')}</Button>
          <Button variant="contained" color="error" onClick={handleDeleteVMRule} startIcon={<i className="ri-delete-bin-line" />}>
            {t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════════════════
          HOST RULE DIALOG
      ═══════════════════════════════════════════════════════════════════ */}
      <Dialog open={hostRuleDialogOpen} onClose={() => setHostRuleDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className="ri-server-line" style={{ fontSize: 20 }} />
            {editingHostRule?.isNew ? t('networkPage.addHostRuleTitle') : t('networkPage.editHostRuleTitle')}
            {editingHostRule?.node && <Chip label={editingHostRule.node} size="small" sx={{ ml: 1 }} />}
          </Box>
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Type</InputLabel>
                <Select value={newHostRule.type} label="Type" onChange={(e) => setNewHostRule({ ...newHostRule, type: e.target.value })}>
                  <MenuItem value="in">IN (entrant)</MenuItem>
                  <MenuItem value="out">OUT (sortant)</MenuItem>
                  <MenuItem value="group">GROUP (Security Group)</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Action</InputLabel>
                {newHostRule.type === 'group' ? (
                  <Select value={newHostRule.action} label="Action" onChange={(e) => setNewHostRule({ ...newHostRule, action: e.target.value })}>
                    {securityGroups.map(sg => (
                      <MenuItem key={sg.group} value={sg.group}>{sg.group}</MenuItem>
                    ))}
                  </Select>
                ) : (
                  <Select value={newHostRule.action} label="Action" onChange={(e) => setNewHostRule({ ...newHostRule, action: e.target.value })}>
                    <MenuItem value="ACCEPT">ACCEPT</MenuItem>
                    <MenuItem value="DROP">DROP</MenuItem>
                    <MenuItem value="REJECT">REJECT</MenuItem>
                  </Select>
                )}
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Actif</InputLabel>
                <Select value={newHostRule.enable} label="Actif" onChange={(e) => setNewHostRule({ ...newHostRule, enable: Number(e.target.value) })}>
                  <MenuItem value={1}>Oui</MenuItem>
                  <MenuItem value={0}>Non</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            {newHostRule.type !== 'group' && (
              <>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField fullWidth size="small" label="Protocole" value={newHostRule.proto} onChange={(e) => setNewHostRule({ ...newHostRule, proto: e.target.value })} placeholder="tcp, udp, icmp..." />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField fullWidth size="small" label="Source" value={newHostRule.source} onChange={(e) => setNewHostRule({ ...newHostRule, source: e.target.value })} placeholder="IP, CIDR, alias..." />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField fullWidth size="small" label="Destination" value={newHostRule.dest} onChange={(e) => setNewHostRule({ ...newHostRule, dest: e.target.value })} placeholder="IP, CIDR, alias..." />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField fullWidth size="small" label="Port destination" value={newHostRule.dport} onChange={(e) => setNewHostRule({ ...newHostRule, dport: e.target.value })} placeholder="22, 80, 443..." />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField fullWidth size="small" label="Port source" value={newHostRule.sport} onChange={(e) => setNewHostRule({ ...newHostRule, sport: e.target.value })} />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField fullWidth size="small" label="Interface" value={newHostRule.iface} onChange={(e) => setNewHostRule({ ...newHostRule, iface: e.target.value })} placeholder="vmbr0, eth0..." />
                </Grid>
              </>
            )}
            <Grid size={{ xs: 12 }}>
              <TextField fullWidth size="small" label="Commentaire" value={newHostRule.comment} onChange={(e) => setNewHostRule({ ...newHostRule, comment: e.target.value })} />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setHostRuleDialogOpen(false)}>Annuler</Button>
          <Button variant="contained" onClick={editingHostRule?.isNew ? handleAddHostRule : handleUpdateHostRule} startIcon={<i className={editingHostRule?.isNew ? "ri-add-line" : "ri-check-line"} />}>
            {editingHostRule?.isNew ? 'Ajouter' : 'Enregistrer'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Host Rule Confirmation */}
      <Dialog open={!!deleteHostRuleConfirm} onClose={() => setDeleteHostRuleConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className="ri-error-warning-line" style={{ fontSize: 20, color: '#ef4444' }} />
            {t('networkPage.deleteRuleConfirm')}
          </Box>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('networkPage.deleteRuleWarning', { pos: deleteHostRuleConfirm?.pos, node: deleteHostRuleConfirm?.node })}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteHostRuleConfirm(null)}>{t('common.cancel')}</Button>
          <Button variant="contained" color="error" onClick={handleDeleteHostRule} startIcon={<i className="ri-delete-bin-line" />}>
            {t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════════════════
          CLUSTER RULE DIALOG
      ═══════════════════════════════════════════════════════════════════ */}
      <Dialog open={clusterRuleDialogOpen} onClose={() => setClusterRuleDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className="ri-cloud-line" style={{ fontSize: 20 }} />
            {editingClusterRule?.isNew ? t('networkPage.addClusterRuleTitle') : t('networkPage.editClusterRuleTitle')}
          </Box>
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Type</InputLabel>
                <Select value={newClusterRule.type} label="Type" onChange={(e) => setNewClusterRule({ ...newClusterRule, type: e.target.value })}>
                  <MenuItem value="in">IN (entrant)</MenuItem>
                  <MenuItem value="out">OUT (sortant)</MenuItem>
                  <MenuItem value="group">GROUP (Security Group)</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Action</InputLabel>
                {newClusterRule.type === 'group' ? (
                  <Select value={newClusterRule.action} label="Action" onChange={(e) => setNewClusterRule({ ...newClusterRule, action: e.target.value })}>
                    {securityGroups.map(sg => (
                      <MenuItem key={sg.group} value={sg.group}>{sg.group}</MenuItem>
                    ))}
                  </Select>
                ) : (
                  <Select value={newClusterRule.action} label="Action" onChange={(e) => setNewClusterRule({ ...newClusterRule, action: e.target.value })}>
                    <MenuItem value="ACCEPT">ACCEPT</MenuItem>
                    <MenuItem value="DROP">DROP</MenuItem>
                    <MenuItem value="REJECT">REJECT</MenuItem>
                  </Select>
                )}
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Actif</InputLabel>
                <Select value={newClusterRule.enable} label="Actif" onChange={(e) => setNewClusterRule({ ...newClusterRule, enable: Number(e.target.value) })}>
                  <MenuItem value={1}>Oui</MenuItem>
                  <MenuItem value={0}>Non</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            {newClusterRule.type !== 'group' && (
              <>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField fullWidth size="small" label="Protocole" value={newClusterRule.proto} onChange={(e) => setNewClusterRule({ ...newClusterRule, proto: e.target.value })} placeholder="tcp, udp, icmp..." />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField fullWidth size="small" label="Source" value={newClusterRule.source} onChange={(e) => setNewClusterRule({ ...newClusterRule, source: e.target.value })} placeholder="IP, CIDR, alias..." />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField fullWidth size="small" label="Destination" value={newClusterRule.dest} onChange={(e) => setNewClusterRule({ ...newClusterRule, dest: e.target.value })} placeholder="IP, CIDR, alias..." />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField fullWidth size="small" label="Port destination" value={newClusterRule.dport} onChange={(e) => setNewClusterRule({ ...newClusterRule, dport: e.target.value })} placeholder="22, 80, 443..." />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField fullWidth size="small" label="Port source" value={newClusterRule.sport} onChange={(e) => setNewClusterRule({ ...newClusterRule, sport: e.target.value })} />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField fullWidth size="small" label="Interface" value={newClusterRule.iface} onChange={(e) => setNewClusterRule({ ...newClusterRule, iface: e.target.value })} placeholder="vmbr0, eth0..." />
                </Grid>
              </>
            )}
            <Grid size={{ xs: 12 }}>
              <TextField fullWidth size="small" label="Commentaire" value={newClusterRule.comment} onChange={(e) => setNewClusterRule({ ...newClusterRule, comment: e.target.value })} />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setClusterRuleDialogOpen(false)}>Annuler</Button>
          <Button variant="contained" onClick={editingClusterRule?.isNew ? handleAddClusterRule : handleUpdateClusterRule} startIcon={<i className={editingClusterRule?.isNew ? "ri-add-line" : "ri-check-line"} />}>
            {editingClusterRule?.isNew ? 'Ajouter' : 'Enregistrer'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Cluster Rule Confirmation */}
      <Dialog open={!!deleteClusterRuleConfirm} onClose={() => setDeleteClusterRuleConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className="ri-error-warning-line" style={{ fontSize: 20, color: '#ef4444' }} />
            {t('networkPage.deleteRuleConfirm')}
          </Box>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('networkPage.deleteClusterRuleWarning', { pos: deleteClusterRuleConfirm?.pos })}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteClusterRuleConfirm(null)}>{t('common.cancel')}</Button>
          <Button variant="contained" color="error" onClick={handleDeleteClusterRule} startIcon={<i className="ri-delete-bin-line" />}>
            {t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* Snackbar */}
      <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar({ ...snackbar, open: false })} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        <Alert severity={snackbar.severity} onClose={() => setSnackbar({ ...snackbar, open: false })}>{snackbar.message}</Alert>
      </Snackbar>
    </Box>
  )
}
