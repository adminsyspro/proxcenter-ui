'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'

import { Box, Card } from '@mui/material'
import { useTranslations } from 'next-intl'
import { ReactFlowProvider } from '@xyflow/react'

import { usePageTitle } from '@/contexts/PageTitleContext'
import { useTenant } from '@/contexts/TenantContext'
import { useRBAC } from '@/contexts/RBACContext'
import { hasInfraScope } from '@/lib/rbac/scopeKinds'

import type { TopologyFilters, SelectedNodeInfo } from './types'
import { useTopologyData } from './hooks/useTopologyData'
import { useTopologyNetworks } from './hooks/useTopologyNetworks'
import TopologyCanvas from './components/TopologyCanvas'
import TopologyToolbar from './components/TopologyToolbar'
import TopologyDetailsSidebar from './components/TopologyDetailsSidebar'
import TopologyGeoView from './components/TopologyGeoView'

export default function TopologyPage() {
  const t = useTranslations()
  const { setPageInfo } = usePageTitle()
  // Topology view is provider-only and infra-scope-only. It is also gated in
  // the menu via requires.isProviderTenant + requires.infraScope. Redirect
  // anyone who hits the URL directly (bookmark, copy-paste) without those
  // rights, instead of letting them load a graph that would re-leak node
  // names hidden everywhere else: tenants, and VM / tag / pool scoped roles
  // (which legitimately keep vm.view to see and start/stop their own guests).
  const { currentTenant, loading: tenantLoading } = useTenant()
  const { scopeTypes, isAdmin, loading: rbacLoading } = useRBAC()
  const isProvider = !currentTenant || currentTenant.id === 'default'
  const allowed = isProvider && hasInfraScope(scopeTypes, isAdmin)
  const router = useRouter()
  useEffect(() => {
    if (!tenantLoading && !rbacLoading && !allowed) {
      router.replace('/')
    }
  }, [tenantLoading, rbacLoading, allowed, router])

  const [filters, setFilters] = useState<TopologyFilters>({
    vmThreshold: 8,
    vmStatus: 'all',
  })

  const [selectedNode, setSelectedNode] = useState<SelectedNodeInfo | null>(null)

  // First pass: get connections (without networkMap)
  const { connections, isLoading } = useTopologyData(filters)

  // Fetch network/VLAN data when groupByVlan is enabled or in network view
  const needsNetworkData = !!filters.groupByVlan || filters.viewMode === 'network'
  const { networkMap } = useTopologyNetworks(connections, needsNetworkData)

  // Second pass: build graph with networkMap when available
  const { nodes, edges } = useTopologyData(
    filters,
    needsNetworkData ? networkMap : undefined
  )

  // Page title
  useEffect(() => {
    setPageInfo(t('navigation.topology'), t('topology.title'), 'ri-mind-map')

    return () => setPageInfo('', '', '')
  }, [setPageInfo, t])

  const handleNodeSelect = useCallback((node: SelectedNodeInfo | null) => {
    setSelectedNode(node)
  }, [])

  // Hold the render until the tenant + RBAC contexts have loaded and the
  // redirect above has had a chance to fire. Avoids a one-frame flash of the
  // graph for users who landed via direct URL without infra rights.
  if (tenantLoading || rbacLoading || !allowed) {
    return null
  }

  return (
    <Box sx={{ height: 'calc(100vh - 130px)', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <ReactFlowProvider>
        <TopologyToolbar filters={filters} onChange={setFilters} connections={connections} />

        {filters.viewMode === 'geo' ? (
          <TopologyGeoView connections={connections} isLoading={isLoading} />
        ) : (
          <Card sx={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            <TopologyCanvas
              nodes={nodes}
              edges={edges}
              isLoading={isLoading}
              onNodeSelect={handleNodeSelect}
            />

            {selectedNode && (
              <TopologyDetailsSidebar node={selectedNode} onClose={() => setSelectedNode(null)} connections={connections} />
            )}
          </Card>
        )}
      </ReactFlowProvider>
    </Box>
  )
}
