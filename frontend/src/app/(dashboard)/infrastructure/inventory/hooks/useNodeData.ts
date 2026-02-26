'use client'

import { useState, useEffect, useCallback } from 'react'
import { parseNodeId } from '../helpers'

interface UseNodeDataResult {
  nodeNotesData: string
  nodeNotesLoading: boolean
  nodeNotesLoaded: boolean
  setNodeNotesData: (v: string) => void
  nodeDisksData: any
  nodeDisksLoading: boolean
  setNodeDisksData: (v: any) => void
  nodeSubscriptionData: any
  nodeSubscriptionLoading: boolean
  setNodeSubscriptionData: (v: any) => void
  nodeReplicationData: any
  nodeReplicationLoading: boolean
  setNodeReplicationData: (v: any) => void
  nodeSystemData: any
  nodeSystemLoading: boolean
  setNodeSystemData: (v: any) => void
  nodeSyslogData: string[]
  nodeSyslogLoading: boolean
  setNodeSyslogData: (v: string[]) => void
  nodeCephData: any
  nodeCephLoading: boolean
  setNodeCephData: (v: any) => void
  nodeShellData: any
  nodeShellConnected: boolean
  nodeShellLoading: boolean
  setNodeShellData: (v: any) => void
  setNodeShellConnected: (v: boolean) => void
  setNodeShellLoading: (v: boolean) => void
  // Expose setters for reload triggers from tab components
  setNodeReplicationLoaded: (v: boolean) => void
  setNodeSystemLoaded: (v: boolean) => void
  setNodeSyslogLoading: (v: boolean) => void
  setNodeDisksLoading: (v: boolean) => void
  setNodeSubscriptionLoading: (v: boolean) => void
}

export function useNodeData(
  selectionType: string | undefined,
  selectionId: string | undefined,
  nodeTab: number,
  nodeSystemSubTab: number,
  nodeDisksSubTab: number,
  setNodeDisksSubTab: (v: number) => void,
  setNodeSystemSubTab: (v: number) => void,
  clusterName: string | undefined,
): UseNodeDataResult {
  // Notes
  const [nodeNotesData, setNodeNotesData] = useState<string>('')
  const [nodeNotesLoading, setNodeNotesLoading] = useState(false)
  const [nodeNotesLoaded, setNodeNotesLoaded] = useState(false)

  // Disks
  const [nodeDisksData, setNodeDisksData] = useState<any>(null)
  const [nodeDisksLoading, setNodeDisksLoading] = useState(false)
  const [nodeDisksLoaded, setNodeDisksLoaded] = useState(false)

  // Subscription
  const [nodeSubscriptionData, setNodeSubscriptionData] = useState<any>(null)
  const [nodeSubscriptionLoading, setNodeSubscriptionLoading] = useState(false)
  const [nodeSubscriptionLoaded, setNodeSubscriptionLoaded] = useState(false)

  // Replication
  const [nodeReplicationData, setNodeReplicationData] = useState<any>(null)
  const [nodeReplicationLoading, setNodeReplicationLoading] = useState(false)
  const [nodeReplicationLoaded, setNodeReplicationLoaded] = useState(false)

  // System
  const [nodeSystemData, setNodeSystemData] = useState<any>(null)
  const [nodeSystemLoading, setNodeSystemLoading] = useState(false)
  const [nodeSystemLoaded, setNodeSystemLoaded] = useState(false)

  // Syslog
  const [nodeSyslogData, setNodeSyslogData] = useState<string[]>([])
  const [nodeSyslogLoading, setNodeSyslogLoading] = useState(false)

  // Ceph
  const [nodeCephData, setNodeCephData] = useState<any>(null)
  const [nodeCephLoading, setNodeCephLoading] = useState(false)
  const [nodeCephLoaded, setNodeCephLoaded] = useState(false)

  // Shell
  const [nodeShellData, setNodeShellData] = useState<any>(null)
  const [nodeShellLoading, setNodeShellLoading] = useState(false)
  const [nodeShellConnected, setNodeShellConnected] = useState(false)

  const isNode = selectionType === 'node'

  // Reset all node data when selection changes
  useEffect(() => {
    setNodeNotesData('')
    setNodeNotesLoaded(false)
    setNodeNotesLoading(false)
    setNodeDisksData(null)
    setNodeDisksLoaded(false)
    setNodeDisksLoading(false)
    setNodeDisksSubTab(0)
    setNodeSubscriptionData(null)
    setNodeSubscriptionLoaded(false)
    setNodeSubscriptionLoading(false)
    setNodeReplicationData(null)
    setNodeReplicationLoaded(false)
    setNodeReplicationLoading(false)
    setNodeSystemData(null)
    setNodeSystemLoaded(false)
    setNodeSystemLoading(false)
    setNodeSystemSubTab(0)
    setNodeSyslogData([])
    setNodeCephData(null)
    setNodeCephLoaded(false)
    setNodeCephLoading(false)
    setNodeShellData(null)
    setNodeShellConnected(false)
  }, [selectionId])

  // Load Notes (nodeTab === 1)
  useEffect(() => {
    if (!isNode || nodeNotesLoaded || nodeNotesLoading || nodeTab !== 1) return

    setNodeNotesLoading(true)
    const { connId, node } = parseNodeId(selectionId || '')

    fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/notes`, { cache: 'no-store' })
      .then(res => res.ok ? res.json() : null)
      .then(json => { if (json) setNodeNotesData(json.data?.notes || '') })
      .catch(e => console.error('Failed to load node notes:', e))
      .finally(() => { setNodeNotesLoading(false); setNodeNotesLoaded(true) })
  }, [isNode, selectionId, nodeTab, nodeNotesLoaded, nodeNotesLoading])

  // Load Disks (nodeTab === 5)
  useEffect(() => {
    if (!isNode || nodeDisksLoaded || nodeDisksLoading || nodeTab !== 5) return

    setNodeDisksLoading(true)
    const { connId, node } = parseNodeId(selectionId || '')

    fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/disks`, { cache: 'no-store' })
      .then(res => res.ok ? res.json() : null)
      .then(json => setNodeDisksData(json ? (json.data || json) : null))
      .catch(e => { console.error('Failed to load node disks:', e); setNodeDisksData(null) })
      .finally(() => { setNodeDisksLoading(false); setNodeDisksLoaded(true) })
  }, [isNode, selectionId, nodeTab, nodeDisksLoaded, nodeDisksLoading])

  // Load Subscription (cluster: tab 11, standalone: tab 12)
  useEffect(() => {
    if (!isNode || nodeSubscriptionLoaded || nodeSubscriptionLoading) return
    const isInCluster = !!clusterName
    const subscriptionTabIndex = isInCluster ? 11 : 12
    if (nodeTab !== subscriptionTabIndex) return

    setNodeSubscriptionLoading(true)
    const { connId, node } = parseNodeId(selectionId || '')

    fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/subscription`, { cache: 'no-store' })
      .then(res => res.ok ? res.json() : null)
      .then(json => setNodeSubscriptionData(json ? (json.data || json) : null))
      .catch(e => { console.error('Failed to load node subscription:', e); setNodeSubscriptionData(null) })
      .finally(() => { setNodeSubscriptionLoading(false); setNodeSubscriptionLoaded(true) })
  }, [isNode, selectionId, nodeTab, nodeSubscriptionLoaded, nodeSubscriptionLoading, clusterName])

  // Load Replication (cluster: tab 8, standalone: tab 9)
  useEffect(() => {
    if (!isNode || nodeReplicationLoaded || nodeReplicationLoading) return
    const isInCluster = !!clusterName
    const replicationTabIndex = isInCluster ? 8 : 9
    if (nodeTab !== replicationTabIndex) return

    setNodeReplicationLoading(true)
    const { connId, node } = parseNodeId(selectionId || '')

    fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/replication`, { cache: 'no-store' })
      .then(res => res.ok ? res.json() : null)
      .then(json => setNodeReplicationData(json ? (json.data || json) : null))
      .catch(e => { console.error('Failed to load node replication:', e); setNodeReplicationData(null) })
      .finally(() => { setNodeReplicationLoading(false); setNodeReplicationLoaded(true) })
  }, [isNode, selectionId, nodeTab, nodeReplicationLoaded, nodeReplicationLoading, clusterName])

  // Load System (nodeTab === 6)
  useEffect(() => {
    if (!isNode || nodeSystemLoaded || nodeSystemLoading || nodeTab !== 6) return

    setNodeSystemLoading(true)
    const { connId, node } = parseNodeId(selectionId || '')

    fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/system`, { cache: 'no-store' })
      .then(res => res.ok ? res.json() : null)
      .then(json => setNodeSystemData(json ? (json.data || json) : null))
      .catch(e => { console.error('Failed to load node system:', e); setNodeSystemData(null) })
      .finally(() => { setNodeSystemLoading(false); setNodeSystemLoaded(true) })
  }, [isNode, selectionId, nodeTab, nodeSystemLoaded, nodeSystemLoading])

  // Load Syslog (nodeTab === 6, nodeSystemSubTab === 6)
  useEffect(() => {
    if (!isNode || nodeTab !== 6 || nodeSystemSubTab !== 6) return

    setNodeSyslogLoading(true)
    const { connId, node } = parseNodeId(selectionId || '')

    fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/syslog?limit=200&_t=${Date.now()}`, { cache: 'no-store' })
      .then(res => res.ok ? res.json() : null)
      .then(json => { if (json) setNodeSyslogData(json.data || []) })
      .catch(e => console.error('Failed to load syslog:', e))
      .finally(() => setNodeSyslogLoading(false))
  }, [isNode, selectionId, nodeTab, nodeSystemSubTab])

  // Load Ceph (cluster nodes only, tab 7)
  useEffect(() => {
    if (!isNode || nodeCephLoaded || nodeCephLoading) return
    const isInCluster = !!clusterName
    if (!isInCluster) return
    const cephTabIndex = 7
    if (nodeTab !== cephTabIndex) return

    setNodeCephLoading(true)
    const { connId, node } = parseNodeId(selectionId || '')

    fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/ceph`, { cache: 'no-store' })
      .then(res => res.ok ? res.json() : { hasCeph: false })
      .then(json => setNodeCephData(json.data || json))
      .catch(e => { console.error('Failed to load node Ceph:', e); setNodeCephData({ hasCeph: false }) })
      .finally(() => { setNodeCephLoading(false); setNodeCephLoaded(true) })
  }, [isNode, selectionId, nodeTab, nodeCephLoaded, nodeCephLoading, clusterName])

  return {
    nodeNotesData, nodeNotesLoading, nodeNotesLoaded, setNodeNotesData,
    nodeDisksData, nodeDisksLoading, setNodeDisksData,
    nodeSubscriptionData, nodeSubscriptionLoading, setNodeSubscriptionData,
    nodeReplicationData, nodeReplicationLoading, setNodeReplicationData,
    nodeSystemData, nodeSystemLoading, setNodeSystemData,
    nodeSyslogData, nodeSyslogLoading, setNodeSyslogData,
    nodeCephData, nodeCephLoading, setNodeCephData,
    nodeShellData, nodeShellConnected, nodeShellLoading,
    setNodeShellData, setNodeShellConnected, setNodeShellLoading,
    setNodeReplicationLoaded, setNodeSystemLoaded, setNodeSyslogLoading,
    setNodeDisksLoading, setNodeSubscriptionLoading,
  }
}
