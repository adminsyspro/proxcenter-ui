'use client'

import React, { useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Box,
  Card,
  CardContent,
  Chip,
  IconButton,
  Stack,
  Tooltip as MuiTooltip,
  Typography,
} from '@mui/material'

import VmsTable, { VmRow, TrendPoint } from '@/components/VmsTable'
import { AllVmItem } from '../InventoryTree'
import type { InventorySelection } from '../types'

type GroupedVmsViewProps = {
  title: string
  icon: string
  groups: {
    key: string
    label: string
    sublabel?: string
    color?: string
    vms: AllVmItem[]
  }[]
  allVms: AllVmItem[]
  onVmClick?: (vm: VmRow) => void
  onVmAction: (vm: VmRow, action: 'start' | 'shutdown' | 'stop' | 'pause' | 'console' | 'details') => void
  onMigrate?: (vm: VmRow) => void
  onLoadTrendsBatch: (vms: VmRow[]) => Promise<Record<string, TrendPoint[]>>
  onSelect?: (sel: InventorySelection) => void
  favorites?: Set<string>
  onToggleFavorite?: (vm: VmRow) => void
  migratingVmIds?: Set<string>
}

function GroupedVmsView({ title, icon, groups, allVms, onVmClick, onVmAction, onMigrate, onLoadTrendsBatch, onSelect, favorites, onToggleFavorite, migratingVmIds }: GroupedVmsViewProps) {
  const t = useTranslations()
  // Par défaut, TOUS les groupes sont repliés
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  
  const toggleGroup = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev)

      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }

      
return next
    })
  }
  
  const expandAll = () => setExpanded(new Set(groups.map(g => g.key)))
  const collapseAll = () => setExpanded(new Set())
  
  // Convertir AllVmItem en VmRow
  const toVmRow = (vm: AllVmItem): VmRow => ({
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
    hastate: vm.hastate,
    hagroup: vm.hagroup,
    isCluster: vm.isCluster,
    osInfo: vm.osInfo,
  })
  
  return (
    <Box sx={{ p: 2, height: '100%', overflow: 'auto' }}>
      <Card variant="outlined" sx={{ width: '100%', borderRadius: 2 }}>
        <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
          {/* Header */}
          <Box sx={{ 
            px: 2, 
            py: 1.5, 
            borderBottom: '1px solid', 
            borderColor: 'divider',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <Typography fontWeight={900} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <i className={icon} style={{ fontSize: 20, opacity: 0.7 }} />
              {title} ({groups.length} {t('inventoryPage.groups')}, {allVms.length} VMs)
            </Typography>
            <Stack direction="row" spacing={0.5}>
              <MuiTooltip title={t('inventoryPage.expandAll')}>
                <IconButton size="small" onClick={expandAll}>
                  <i className="ri-expand-up-down-line" style={{ fontSize: 16 }} />
                </IconButton>
              </MuiTooltip>
              <MuiTooltip title={t('inventoryPage.collapseAll')}>
                <IconButton size="small" onClick={collapseAll}>
                  <i className="ri-collapse-vertical-line" style={{ fontSize: 16 }} />
                </IconButton>
              </MuiTooltip>
            </Stack>
          </Box>
          
          {/* Groups */}
          <Box sx={{ maxHeight: 'calc(100vh - 280px)', overflow: 'auto' }}>
            {groups.map(group => {
              const isExpanded = expanded.has(group.key)
              const runningCount = group.vms.filter(v => v.status === 'running').length
              
              return (
                <Box key={group.key}>
                  {/* Group Header */}
                  <Box
                    onClick={() => toggleGroup(group.key)}
                    sx={{
                      px: 2,
                      py: 1,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      cursor: 'pointer',
                      bgcolor: isExpanded ? 'action.selected' : 'action.hover',
                      borderBottom: '1px solid',
                      borderColor: 'divider',
                      '&:hover': { bgcolor: 'action.selected' }
                    }}
                  >
                    <i 
                      className={isExpanded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} 
                      style={{ fontSize: 18, opacity: 0.7 }} 
                    />
                    {group.color && (
                      <Box sx={{ 
                        width: 12, 
                        height: 12, 
                        borderRadius: 0.5, 
                        bgcolor: group.color 
                      }} />
                    )}
                    <Typography fontWeight={700} sx={{ flex: 1 }}>
                      {group.label}
                    </Typography>
                    {group.sublabel && (
                      <Typography variant="caption" sx={{ opacity: 0.6 }}>
                        {group.sublabel}
                      </Typography>
                    )}
                    <Chip 
                      size="small" 
                      label={`${runningCount}/${group.vms.length}`}
                      color={runningCount > 0 ? 'success' : 'default'}
                      sx={{ height: 20, fontSize: '0.7rem' }}
                    />
                  </Box>
                  
                  {/* VMs Table - seulement si expanded (les trends ne se chargent que si visible) */}
                  {isExpanded && (
                    <Box sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
                      <VmsTable
                        vms={group.vms.map(toVmRow)}
                        compact
                        showTrends
                        showActions
                        onLoadTrendsBatch={onLoadTrendsBatch}
                        onVmClick={onVmClick}
                        onVmAction={onVmAction}
                        onMigrate={onMigrate}
                        maxHeight="auto"
                        favorites={favorites}
                        onToggleFavorite={onToggleFavorite}
                        migratingVmIds={migratingVmIds}
                      />
                    </Box>
                  )}
                </Box>
              )
            })}
          </Box>
        </CardContent>
      </Card>
    </Box>
  )
}


export default GroupedVmsView
