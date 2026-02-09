'use client'

import React, { useCallback, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Select,
  Stack,
  Tab,
  Table,
  Tooltip as MuiTooltip,
  Typography,
  useTheme,
} from '@mui/material'

const PlayArrowIcon = (props: any) => <i className="ri-play-fill" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const StopIcon = (props: any) => <i className="ri-stop-fill" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const PowerSettingsNewIcon = (props: any) => <i className="ri-shut-down-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const MoveUpIcon = (props: any) => <i className="ri-upload-2-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />

import { BulkAction } from '@/components/NodesTable'
import VmsTable, { VmRow, TrendPoint } from '@/components/VmsTable'
import { ViewMode, AllVmItem, HostItem, PoolItem, TagItem } from './InventoryTree'
import type { InventorySelection } from './types'

function RootInventoryView({
  allVms,
  hosts,
  pbsServers,
  onVmClick,
  onVmAction,
  onMigrate,
  onNodeClick,
  onSelect,
  favorites,
  onToggleFavorite,
  migratingVmIds,
  onLoadTrendsBatch,
  showIpSnap,
  ipSnapLoading,
  onLoadIpSnap,
  onCreateVm,
  onCreateLxc,
  onBulkAction,
}: {
  allVms: AllVmItem[]
  hosts: HostItem[]
  pbsServers?: { connId: string; name: string; status: string; backupCount: number }[]
  onVmClick: (vm: VmRow) => void
  onVmAction: (vm: VmRow, action: any) => void
  onMigrate: (vm: { connId: string; node: string; type: string; vmid: string | number; name: string }) => void
  onNodeClick: (connId: string, node: string) => void
  onSelect?: (sel: InventorySelection) => void
  favorites?: Set<string>
  onToggleFavorite?: (vm: { id: string; connId: string; node: string; type: string; vmid: string | number; name?: string }) => void
  migratingVmIds?: Set<string>
  onLoadTrendsBatch?: (vms: VmRow[]) => Promise<Record<string, TrendPoint[]>>
  showIpSnap?: boolean
  ipSnapLoading?: boolean
  onLoadIpSnap?: () => void
  onCreateVm?: () => void
  onCreateLxc?: () => void
  onBulkAction?: (host: HostItem, action: BulkAction) => void
}) {
  const t = useTranslations()
  const theme = useTheme()
  
  // Grouper les VMs par cluster (connexion)
  const clusters = useMemo(() => {
    const map = new Map<string, { connId: string; connName: string; vms: AllVmItem[] }>()
    
    allVms.forEach(vm => {
      if (!map.has(vm.connId)) {
        map.set(vm.connId, { connId: vm.connId, connName: vm.connName, vms: [] })
      }
      map.get(vm.connId)!.vms.push(vm)
    })
    
    return Array.from(map.values()).sort((a, b) => a.connName.localeCompare(b.connName))
  }, [allVms])

  // État pour sections collapsed - par défaut tout est replié (on stocke les IDs dépliés, pas repliés)
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set())
  const [expandedHosts, setExpandedHosts] = useState<Set<string>>(new Set())

  // Context menu state for host bulk actions
  const [hostContextMenu, setHostContextMenu] = useState<{
    mouseX: number
    mouseY: number
    host: HostItem
    isCluster: boolean
  } | null>(null)

  const handleHostContextMenu = useCallback((event: React.MouseEvent, host: HostItem, isCluster: boolean) => {
    event.preventDefault()
    event.stopPropagation()
    setHostContextMenu({
      mouseX: event.clientX,
      mouseY: event.clientY,
      host,
      isCluster,
    })
  }, [])

  const handleCloseHostContextMenu = useCallback(() => {
    setHostContextMenu(null)
  }, [])

  const handleHostBulkAction = useCallback((action: BulkAction) => {
    if (!hostContextMenu || !onBulkAction) return
    onBulkAction(hostContextMenu.host, action)
    handleCloseHostContextMenu()
  }, [hostContextMenu, onBulkAction, handleCloseHostContextMenu])

  // Wrapper pour onToggleFavorite qui passe le VmRow directement
  const handleToggleFavorite = useCallback((vm: VmRow) => {
    onToggleFavorite?.({
      id: vm.id,
      connId: vm.connId,
      node: vm.node,
      type: vm.type,
      vmid: vm.vmid,
      name: vm.name
    })
  }, [onToggleFavorite])
  
  // Helper pour calculer les stats CPU/RAM d'un groupe de VMs
  const calculateStats = (vms: AllVmItem[]) => {
    const runningVms = vms.filter(vm => vm.status === 'running')
    if (runningVms.length === 0) return { avgCpu: 0, avgRam: 0, totalMem: 0, usedMem: 0 }
    
    let totalCpu = 0
    let totalMem = 0
    let usedMem = 0
    let cpuCount = 0
    let memCount = 0
    
    runningVms.forEach(vm => {
      if (vm.cpu !== undefined) {
        totalCpu += vm.cpu * 100
        cpuCount++
      }
      if (vm.mem !== undefined && vm.maxmem !== undefined && vm.maxmem > 0) {
        usedMem += vm.mem
        totalMem += vm.maxmem
        memCount++
      }
    })
    
    return {
      avgCpu: cpuCount > 0 ? totalCpu / cpuCount : 0,
      avgRam: totalMem > 0 ? (usedMem / totalMem) * 100 : 0,
      totalMem,
      usedMem
    }
  }
  
  // Compter les VMs par statut
  const vmStats = useMemo(() => {
    const running = allVms.filter(vm => vm.status === 'running').length
    const stopped = allVms.filter(vm => vm.status === 'stopped').length
    const other = allVms.length - running - stopped
    return { running, stopped, other, total: allVms.length }
  }, [allVms])
  
  const toggleCluster = (connId: string) => {
    setExpandedClusters(prev => {
      const next = new Set(prev)
      if (next.has(connId)) next.delete(connId)
      else next.add(connId)
      return next
    })
  }
  
  const toggleHost = (key: string) => {
    setExpandedHosts(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  
  // Expand/Collapse all
  const expandAll = () => {
    setExpandedClusters(new Set(clusters.map(c => c.connId)))
    setExpandedHosts(new Set(hosts.map(h => h.key)))
  }
  
  const collapseAll = () => {
    setExpandedClusters(new Set())
    setExpandedHosts(new Set())
  }
  
  // Composant mini barre de progression
  const MiniProgressBar = ({ value, color, label }: { value: number; color: string; label: string }) => (
    <MuiTooltip title={`${label}: ${value.toFixed(1)}%`}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 120 }}>
        <Typography variant="caption" sx={{ fontSize: 11, opacity: 0.7, minWidth: 28 }}>{label}</Typography>
        <Box sx={{ 
          width: 60,
          height: 8, 
          bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)', 
          borderRadius: 1,
          overflow: 'hidden'
        }}>
          <Box sx={{ 
            width: `${Math.min(100, value)}%`, 
            height: '100%', 
            bgcolor: value > 90 ? 'error.main' : value > 70 ? 'warning.main' : color,
            borderRadius: 1,
            transition: 'width 0.3s ease'
          }} />
        </Box>
        <Typography variant="caption" sx={{ fontSize: 11, fontWeight: 600, minWidth: 32, textAlign: 'right' }}>
          {value.toFixed(0)}%
        </Typography>
      </Box>
    </MuiTooltip>
  )

  return (
    <Box sx={{ height: '100%', overflow: 'auto', p: 2.5 }}>
      {/* Header */}
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2}>
            <Stack direction="row" alignItems="center" spacing={2}>
              <Box sx={{ 
                width: 48, 
                height: 48, 
                borderRadius: 2, 
                bgcolor: 'primary.main', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center' 
              }}>
                <i className="ri-stack-fill" style={{ fontSize: 24, color: 'white' }} />
              </Box>
              <Box>
                <Typography variant="h5" fontWeight={900}>{t('navigation.inventory')}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {clusters.length} {clusters.length > 1 ? 'clusters' : 'cluster'} • {hosts.length} {t('inventory.nodes')} • {vmStats.total} VMs{pbsServers && pbsServers.length > 0 ? ` • ${pbsServers.length} PBS` : ''}
                </Typography>
              </Box>
            </Stack>
            
            {/* Stats rapides */}
            <Stack direction="row" spacing={3}>
              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="h4" fontWeight={900} color="success.main">{vmStats.running}</Typography>
                <Typography variant="caption" color="text.secondary">Running</Typography>
              </Box>
              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="h4" fontWeight={900} color="text.disabled">{vmStats.stopped}</Typography>
                <Typography variant="caption" color="text.secondary">Stopped</Typography>
              </Box>
              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="h4" fontWeight={900} color="primary.main">{hosts.length}</Typography>
                <Typography variant="caption" color="text.secondary">{t('inventory.nodes')}</Typography>
              </Box>
              {pbsServers && pbsServers.length > 0 && (
                <Box sx={{ textAlign: 'center' }}>
                  <Typography variant="h4" fontWeight={900} sx={{ color: '#2196f3' }}>{pbsServers.length}</Typography>
                  <Typography variant="caption" color="text.secondary">PBS</Typography>
                </Box>
              )}
            </Stack>
            
            {/* Actions */}
            <Stack direction="row" spacing={1}>
              {onCreateVm && (
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<i className="ri-add-line" />}
                  onClick={onCreateVm}
                  sx={{ textTransform: 'none' }}
                >
                  {t('common.create')} VM
                </Button>
              )}
              {onCreateLxc && (
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<i className="ri-add-line" />}
                  onClick={onCreateLxc}
                  sx={{ textTransform: 'none' }}
                >
                  {t('common.create')} LXC
                </Button>
              )}
              <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
              <Button size="small" variant="text" onClick={expandAll} startIcon={<i className="ri-expand-diagonal-line" />}>
                {t('common.expandAll')}
              </Button>
              <Button size="small" variant="text" onClick={collapseAll} startIcon={<i className="ri-collapse-diagonal-line" />}>
                {t('common.collapseAll')}
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>
      
      {/* Séparateur PVE */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <i className="ri-server-fill" style={{ fontSize: 16, color: '#F29221' }} />
        <Typography variant="subtitle2" fontWeight={700} sx={{ opacity: 0.7 }}>Proxmox VE</Typography>
        <Box sx={{ flex: 1, height: 1, bgcolor: 'divider', ml: 1 }} />
      </Box>

      {/* Liste des Clusters avec leurs Hosts et VMs */}
      <Stack spacing={2}>
        {clusters.map(cluster => {
          const isClusterCollapsed = !expandedClusters.has(cluster.connId)
          const clusterHosts = hosts.filter(h => h.connId === cluster.connId)
          const runningCount = cluster.vms.filter(vm => vm.status === 'running').length
          const clusterStats = calculateStats(cluster.vms)
          const isRealCluster = clusterHosts.length > 1 // Vrai cluster si plusieurs nodes
          
          return (
            <Card key={cluster.connId} variant="outlined">
              {/* Header Cluster */}
              <Box 
                onClick={() => toggleCluster(cluster.connId)}
                sx={{ 
                  px: 2, 
                  py: 1.5, 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 1.5,
                  cursor: 'pointer',
                  bgcolor: theme.palette.mode === 'dark' ? 'rgba(242, 146, 33, 0.08)' : 'rgba(242, 146, 33, 0.05)',
                  borderBottom: isClusterCollapsed ? 'none' : '1px solid',
                  borderColor: 'divider',
                  '&:hover': { bgcolor: theme.palette.mode === 'dark' ? 'rgba(242, 146, 33, 0.12)' : 'rgba(242, 146, 33, 0.08)' }
                }}
              >
                <i 
                  className={isClusterCollapsed ? "ri-arrow-right-s-line" : "ri-arrow-down-s-line"} 
                  style={{ fontSize: 20, opacity: 0.7 }} 
                />
                <i className={isRealCluster ? "ri-cloud-fill" : "ri-server-fill"} style={{ fontSize: 18, color: '#F29221' }} />
                <Typography fontWeight={700}>{cluster.connName}</Typography>
                <Chip 
                  size="small" 
                  label={`${clusterHosts.length} ${t('inventory.nodes')}`} 
                  sx={{ height: 20, fontSize: 11 }} 
                />
                <Chip 
                  size="small" 
                  label={`${cluster.vms.length} VMs`} 
                  sx={{ height: 20, fontSize: 11 }} 
                />
                <Chip 
                  size="small" 
                  label={`${runningCount} running`} 
                  color="success"
                  variant="outlined"
                  sx={{ height: 20, fontSize: 11 }} 
                />
                
                {/* Indicateurs CPU/RAM du cluster */}
                <Box sx={{ ml: 'auto', display: 'flex', gap: 2 }} onClick={(e) => e.stopPropagation()}>
                  <MiniProgressBar value={clusterStats.avgCpu} color="info.main" label="CPU" />
                  <MiniProgressBar value={clusterStats.avgRam} color="secondary.main" label="RAM" />
                </Box>
              </Box>
              
              {/* Contenu Cluster (Hosts) */}
              {!isClusterCollapsed && (
                <Box sx={{ pl: 2 }}>
                  {clusterHosts.map(host => {
                    const isHostCollapsed = !expandedHosts.has(host.key)
                    const hostRunning = host.vms.filter(vm => vm.status === 'running').length
                    const hostStats = calculateStats(host.vms)
                    
                    return (
                      <Box key={host.key}>
                        {/* Header Host */}
                        <Box
                          onClick={() => toggleHost(host.key)}
                          onContextMenu={(e) => onBulkAction && handleHostContextMenu(e, host, isRealCluster)}
                          sx={{
                            px: 2,
                            py: 1,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1.5,
                            cursor: 'pointer',
                            borderBottom: '1px solid',
                            borderColor: 'divider',
                            '&:hover': { bgcolor: 'action.hover' }
                          }}
                        >
                          <i 
                            className={isHostCollapsed ? "ri-arrow-right-s-line" : "ri-arrow-down-s-line"} 
                            style={{ fontSize: 18, opacity: 0.7 }} 
                          />
                          <i className="ri-server-fill" style={{ fontSize: 16, opacity: 0.7 }} />
                          <Typography 
                            variant="body2" 
                            fontWeight={600}
                            sx={{ 
                              cursor: 'pointer',
                              '&:hover': { color: 'primary.main', textDecoration: 'underline' }
                            }}
                            onClick={(e) => {
                              e.stopPropagation()
                              onNodeClick(host.connId, host.node)
                            }}
                          >
                            {host.node}
                          </Typography>
                          <Typography variant="caption" sx={{ opacity: 0.5 }}>
                            ({host.vms.length} VMs, {hostRunning} running)
                          </Typography>
                          
                          {/* Indicateurs CPU/RAM du host */}
                          <Box sx={{ ml: 'auto', display: 'flex', gap: 2 }} onClick={(e) => e.stopPropagation()}>
                            <MiniProgressBar value={hostStats.avgCpu} color="info.main" label="CPU" />
                            <MiniProgressBar value={hostStats.avgRam} color="secondary.main" label="RAM" />
                          </Box>
                        </Box>
                        
                        {/* VMs du Host */}
                        {!isHostCollapsed && host.vms.length > 0 && (
                          <Box sx={{ pl: 2, py: 1 }}>
                            <VmsTable
                              vms={host.vms.map(vm => ({
                                id: `${vm.connId}:${vm.node}:${vm.type}:${vm.vmid}`,
                                connId: vm.connId,
                                node: vm.node,
                                vmid: vm.vmid,
                                name: vm.name,
                                type: vm.type,
                                status: vm.status || 'unknown',
                                cpu: vm.status === 'running' && vm.cpu !== undefined ? Math.min(100, vm.cpu * 100) : undefined,
                                ram: vm.status === 'running' && vm.mem !== undefined && vm.maxmem ? (vm.mem / vm.maxmem) * 100 : undefined,
                                maxmem: vm.maxmem,
                                maxdisk: vm.maxdisk,
                                uptime: vm.uptime,
                                ip: vm.ip,
                                snapshots: vm.snapshots,
                                tags: vm.tags,
                                template: vm.template,
                                isCluster: vm.isCluster,
                                osInfo: vm.osInfo,
                              }))}
                              compact
                              showActions
                              onVmClick={onVmClick}
                              onVmAction={onVmAction}
                              onMigrate={onMigrate}
                              maxHeight={300}
                              favorites={favorites}
                              onToggleFavorite={handleToggleFavorite}
                              migratingVmIds={migratingVmIds}
                            />
                          </Box>
                        )}
                      </Box>
                    )
                  })}
                </Box>
              )}
            </Card>
          )
        })}

        {/* Séparateur PBS */}
        {pbsServers && pbsServers.length > 0 && (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 3, mb: 1 }}>
              <i className="ri-hard-drive-2-fill" style={{ fontSize: 16, color: '#2196f3' }} />
              <Typography variant="subtitle2" fontWeight={700} sx={{ opacity: 0.7 }}>Proxmox Backup Server</Typography>
              <Chip size="small" label={`${pbsServers.reduce((acc, pbs) => acc + pbs.backupCount, 0)} backups`} sx={{ height: 18, fontSize: 10, ml: 1 }} />
              <Box sx={{ flex: 1, height: 1, bgcolor: 'divider', ml: 1 }} />
            </Box>

            <Stack spacing={1}>
              {pbsServers.map(pbs => (
                <Card 
                  key={pbs.connId}
                  variant="outlined"
                  onClick={() => onSelect?.({ type: 'pbs', id: pbs.connId })}
                  sx={{ 
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'action.hover' }
                  }}
                >
                  <Box 
                    sx={{ 
                      px: 2, 
                      py: 1.5, 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: 1.5,
                      bgcolor: theme.palette.mode === 'dark' ? 'rgba(33, 150, 243, 0.08)' : 'rgba(33, 150, 243, 0.05)',
                    }}
                  >
                    <i className="ri-hard-drive-2-fill" style={{ fontSize: 18, color: '#2196f3' }} />
                    <Typography fontWeight={700}>{pbs.name}</Typography>
                    <Typography variant="caption" sx={{ opacity: 0.6, ml: 'auto' }}>
                      {pbs.backupCount} backups
                    </Typography>
                  </Box>
                </Card>
              ))}
            </Stack>
          </>
        )}
      </Stack>

      {/* Context menu for host bulk actions */}
      {onBulkAction && (
        <Menu
          open={hostContextMenu !== null}
          onClose={handleCloseHostContextMenu}
          anchorReference="anchorPosition"
          anchorPosition={
            hostContextMenu !== null
              ? { top: hostContextMenu.mouseY, left: hostContextMenu.mouseX }
              : undefined
          }
        >
          {/* Header */}
          <Box sx={{ px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Typography variant="subtitle2" fontWeight={600}>
              {hostContextMenu?.host.node}
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.6 }}>
              {hostContextMenu?.host.vms.length ?? 0} VMs
            </Typography>
          </Box>

          <MenuItem onClick={() => handleHostBulkAction('start-all')}>
            <ListItemIcon>
              <PlayArrowIcon fontSize="small" sx={{ color: 'success.main' }} />
            </ListItemIcon>
            <ListItemText>{t('bulkActions.startAllVms')}</ListItemText>
          </MenuItem>

          <MenuItem onClick={() => handleHostBulkAction('shutdown-all')}>
            <ListItemIcon>
              <PowerSettingsNewIcon fontSize="small" sx={{ color: 'warning.main' }} />
            </ListItemIcon>
            <ListItemText>{t('bulkActions.shutdownAllVms')}</ListItemText>
          </MenuItem>

          <MenuItem onClick={() => handleHostBulkAction('stop-all')}>
            <ListItemIcon>
              <StopIcon fontSize="small" sx={{ color: 'error.main' }} />
            </ListItemIcon>
            <ListItemText>{t('bulkActions.stopAllVms')}</ListItemText>
          </MenuItem>

          {hostContextMenu?.isCluster && (
            <>
              <Divider />
              <MenuItem onClick={() => handleHostBulkAction('migrate-all')}>
                <ListItemIcon>
                  <MoveUpIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t('bulkActions.migrateAllVms')}</ListItemText>
              </MenuItem>
            </>
          )}
        </Menu>
      )}
    </Box>
  )
}


export default RootInventoryView
