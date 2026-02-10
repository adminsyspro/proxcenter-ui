'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'

import { Box, Card, CardContent, CircularProgress, Typography, IconButton, Tooltip } from '@mui/material'

import { useTranslations } from 'next-intl'

import { usePageTitle } from '@/contexts/PageTitleContext'

import InventoryTree, { InventorySelection, ViewMode, AllVmItem, HostItem, PoolItem, TagItem, TreePbsServer } from './InventoryTree'
import InventoryDetails from './InventoryDetails'

type Connection = {
  id: string
  name: string
  baseUrl: string
  uiUrl?: string
  insecureTLS?: boolean
}

// Type pour les VMs en migration
type MigratingVm = {
  connId: string
  vmid: string
  sourceNode: string
  targetNode?: string
}

const MIN_LEFT_WIDTH = 200
const MAX_LEFT_WIDTH = 500
const DEFAULT_LEFT_WIDTH = 340
const COLLAPSED_WIDTH = 52

export default function InventoryPage() {
  const t = useTranslations()
  const { setPageInfo } = usePageTitle()
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const [connections, setConnections] = useState<Connection[]>([])
  const [selection, setSelection] = useState<InventorySelection | null>({ type: 'root', id: 'root' })
  const [refreshTree, setRefreshTree] = useState<(() => void) | null>(null)

  // Mode de vue actuel et listes de données
  const [viewMode, setViewMode] = useState<ViewMode>('tree')
  const [hosts, setHosts] = useState<HostItem[]>([])
  const [pools, setPools] = useState<PoolItem[]>([])
  const [tags, setTags] = useState<TagItem[]>([])
  const [pbsServers, setPbsServers] = useState<TreePbsServer[]>([])
  
  // État pour IP/Snapshots
  const [ipSnapLoading, setIpSnapLoading] = useState(false)
  const [ipSnapLoaded, setIpSnapLoaded] = useState(false)

  // Favoris (partagés entre Tree et Details)
  const [favorites, setFavorites] = useState<Set<string>>(new Set())
  
  // État pour collapse la tree
  const [isTreeCollapsed, setIsTreeCollapsed] = useState(false)

  // Données brutes des VMs (depuis InventoryTree) et données enrichies (IP, snapshots, uptime)
  const [rawVms, setRawVms] = useState<AllVmItem[]>([])
  const [enrichedData, setEnrichedData] = useState<Record<string, { ip?: string | null; snapshots?: number; uptime?: string | null; osInfo?: { type: 'linux' | 'windows' | 'other'; name: string | null; version: string | null; kernel: string | null } | null }>>({})

  // VMs en cours de migration
  const [migratingVms, setMigratingVms] = useState<MigratingVm[]>([])
  
  // Référence pour détecter les migrations terminées
  const prevMigratingVmsRef = useRef<MigratingVm[]>([])

  // Polling des tâches en cours pour détecter les migrations
  useEffect(() => {
    const fetchRunningTasks = async () => {
      try {
        const res = await fetch('/api/v1/tasks/running')

        if (!res.ok) return
        const json = await res.json()
        const tasks = json.data || []
        
        // Filtrer les tâches de migration (qmigrate, vzmigrate, hamigrate)
        // Note: Proxmox utilise qmigrate (pas qmmigrate) dans les tâches
        const migrations: MigratingVm[] = tasks
          .filter((t: any) => t.type === 'qmigrate' || t.type === 'vzmigrate' || t.type === 'hamigrate')
          .map((t: any) => ({
            connId: t.connectionId,
            vmid: t.entity || '', // entity contient le VMID
            sourceNode: t.node,
            targetNode: undefined // On pourrait parser l'UPID pour trouver la cible
          }))
          .filter((m: MigratingVm) => m.vmid) // Garder seulement ceux avec un VMID
        
        // Détecter les migrations terminées (étaient en cours, ne le sont plus)
        const prevIds = new Set(prevMigratingVmsRef.current.map(m => `${m.connId}:${m.vmid}`))
        const currentIds = new Set(migrations.map(m => `${m.connId}:${m.vmid}`))
        
        const finishedMigrations = prevMigratingVmsRef.current.filter(
          m => !currentIds.has(`${m.connId}:${m.vmid}`)
        )
        
        // Si des migrations viennent de se terminer, rafraîchir l'inventaire
        if (finishedMigrations.length > 0) {
          console.log('[Migration] Migrations terminées:', finishedMigrations.map(m => m.vmid))

          // Rafraîchir l'arbre après un court délai pour laisser Proxmox mettre à jour
          setTimeout(() => {
            if (refreshTree) {
              refreshTree()
            }
          }, 1000)
        }
        
        // Mettre à jour la référence
        prevMigratingVmsRef.current = migrations
        setMigratingVms(migrations)
      } catch (e) {
        console.error('Error fetching running tasks:', e)
      }
    }

    // Fetch initial
    fetchRunningTasks()

    // Polling toutes les 3 secondes
    const interval = setInterval(fetchRunningTasks, 3000)

    return () => clearInterval(interval)
  }, [refreshTree])

  // Page title
  useEffect(() => {
    setPageInfo(t('navigation.inventory'), t('inventory.vms') + ' & ' + t('inventory.containers'), 'ri-database-fill')
    
return () => setPageInfo('', '', '')
  }, [setPageInfo, t])

  // Merger automatique des VMs brutes avec les données enrichies et le statut de migration
  const allVms = useMemo(() => {
    return rawVms.map(vm => {
      const key = `${vm.connId}:${vm.type}:${vm.node}:${vm.vmid}`
      const enriched = enrichedData[key]
      
      // Vérifier si cette VM est en cours de migration
      const migrating = migratingVms.find(m => 
        m.connId === vm.connId && m.vmid === vm.vmid
      )
      
      const result: AllVmItem = {
        ...vm,
        isMigrating: !!migrating,
        migrationTarget: migrating?.targetNode
      }
      
      if (enriched) {
        result.ip = enriched.ip ?? vm.ip
        result.snapshots = enriched.snapshots ?? vm.snapshots
        result.uptime = enriched.uptime ?? vm.uptime
        result.osInfo = enriched.osInfo ?? (vm as any).osInfo
      }
      
      return result
    })
  }, [rawVms, enrichedData, migratingVms])

  // Set des VMs en migration pour InventoryTree (format: "connId:vmid")
  const migratingVmIds = useMemo(() => {
    return new Set(migratingVms.map(m => `${m.connId}:${m.vmid}`))
  }, [migratingVms])

  // Charger les favoris
  const loadFavorites = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/favorites')

      if (res.ok) {
        const json = await res.json()
        const favSet = new Set<string>((json.data || []).map((f: any) => f.vm_key))

        setFavorites(favSet)
      }
    } catch (e) {
      console.error('Error loading favorites:', e)
    }
  }, [])

  // Toggle favori
  const toggleFavorite = useCallback(async (vm: { connId: string; node: string; type: string; vmid: string | number; name?: string }) => {
    const vmKey = `${vm.connId}:${vm.node}:${vm.type}:${vm.vmid}`
    const isFav = favorites.has(vmKey)

    try {
      if (isFav) {
        const res = await fetch(`/api/v1/favorites?vmKey=${encodeURIComponent(vmKey)}`, { method: 'DELETE' })

        if (res.ok) {
          setFavorites(prev => {
            const next = new Set(prev)

            next.delete(vmKey)

            return next
          })
        }
      } else {
        const res = await fetch('/api/v1/favorites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            connectionId: vm.connId,
            node: vm.node,
            vmType: vm.type,
            vmid: vm.vmid,
            vmName: vm.name
          })
        })

        if (res.ok) {
          setFavorites(prev => new Set(prev).add(vmKey))
        }
      }
    } catch (e) {
      console.error('Error toggling favorite:', e)
    }
  }, [favorites])

  // Largeur du panneau gauche (resizable)
  const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT_WIDTH)
  const [isResizing, setIsResizing] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleRefreshRef = useCallback((refresh: () => void) => {
    setRefreshTree(() => refresh)
  }, [])

  const loadConnections = async () => {
    setLoading(true)
    setErr(null)

    try {
      // Charger uniquement les connexions PVE (pas PBS)
      const res = await fetch('/api/v1/connections?type=pve')
      const json = await res.json()
      const list = Array.isArray(json?.data) ? json.data : []

      setConnections(list)
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to load connections')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadConnections()
    void loadFavorites()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Quand on passe en mode tree, sélectionner automatiquement 'root' pour afficher la vue arborescente
  useEffect(() => {
    if (viewMode === 'tree' && (!selection || selection.type !== 'root')) {
      setSelection({ type: 'root', id: 'root' })
    }
  }, [viewMode])

  // Gestion du resize
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }, [])

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return
      const containerRect = containerRef.current.getBoundingClientRect()
      const newWidth = e.clientX - containerRect.left

      setLeftWidth(Math.min(MAX_LEFT_WIDTH, Math.max(MIN_LEFT_WIDTH, newWidth)))
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing])

  // Charger les IP, Snapshots et Uptime pour toutes les VMs
  const loadIpSnap = useCallback(async () => {
    if (ipSnapLoading || rawVms.length === 0) return
    
    setIpSnapLoading(true)
    
    // Grouper les VMs par connexion
    const byConnection: Record<string, typeof rawVms> = {}

    rawVms.forEach(vm => {
      if (!byConnection[vm.connId]) {
        byConnection[vm.connId] = []
      }

      byConnection[vm.connId].push(vm)
    })
    
    // Charger par connexion en parallèle
    try {
      const newEnrichedData: Record<string, { ip?: string | null; snapshots?: number; uptime?: string | null }> = { ...enrichedData }
      
      await Promise.all(
        Object.entries(byConnection).map(async ([connId, vms]) => {
          const vmsToFetch = vms.map(v => ({
            connId: v.connId,
            type: v.type,
            node: v.node,
            vmid: v.vmid,
            status: v.status
          }))
          
          try {
            const res = await fetch('/api/v1/vms/ips', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ vms: vmsToFetch })
            })
            
            if (!res.ok) return
            const json = await res.json()
            const data = json.data || {}
            
            // Stocker les données enrichies
            for (const [key, value] of Object.entries(data)) {
              newEnrichedData[key] = value as { ip?: string | null; snapshots?: number; uptime?: string | null; osInfo?: { type: 'linux' | 'windows' | 'other'; name: string | null; version: string | null; kernel: string | null } | null }
            }
          } catch (e) {
            console.error('Error loading IPs for connection:', connId, e)
          }
        })
      )
      
      setEnrichedData(newEnrichedData)
    } finally {
      setIpSnapLoading(false)
      setIpSnapLoaded(true)
    }
  }, [rawVms, ipSnapLoading, enrichedData])

  return (
    <Box
      ref={containerRef}
      sx={{
        // IMPORTANT: permettre aux enfants de scroller
        minHeight: 0,

        // Layout vCenter-like : 2 panneaux côte à côte (sur desktop)
        display: 'flex',
        flexDirection: { xs: 'column', lg: 'row' },

        // Hauteur maximale - occupe tout l'espace disponible avec marge pour la barre de tâches
        height: { xs: 'auto', lg: 'calc(100vh - 130px)' },
        maxHeight: { lg: 'calc(100vh - 130px)' },
        overflow: 'hidden',

        // Curseur de resize global pendant le drag
        cursor: isResizing ? 'col-resize' : 'default',
        userSelect: isResizing ? 'none' : 'auto',
      }}
    >
      {/* LEFT: Tree */}
      <Card
        variant='outlined'
        sx={{
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          width: { xs: '100%', lg: isTreeCollapsed ? COLLAPSED_WIDTH : leftWidth },
          minWidth: { lg: isTreeCollapsed ? COLLAPSED_WIDTH : MIN_LEFT_WIDTH },
          maxWidth: { lg: isTreeCollapsed ? COLLAPSED_WIDTH : MAX_LEFT_WIDTH },
          flex: { xs: 'none', lg: '0 0 auto' },
          transition: 'width 0.2s ease, min-width 0.2s ease, max-width 0.2s ease',
          overflow: 'hidden',
        }}
      >
        {/* Header fixe (collapsed: juste le bouton expand) */}
        {isTreeCollapsed && (
          <CardContent sx={{ pt: 1.5, pb: 1, px: 1, display: 'flex', justifyContent: 'center' }}>
            <Tooltip title={t('common.showMore')}>
              <IconButton
                size='small'
                onClick={() => setIsTreeCollapsed(false)}
                sx={{
                  bgcolor: 'action.hover',
                  '&:hover': { bgcolor: 'action.selected' }
                }}
              >
                <i className='ri-side-bar-fill' style={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </CardContent>
        )}

        {/* Contenu scrollable - masqué quand collapsed */}
        {!isTreeCollapsed && (
          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', px: 2, pb: 2 }}>
          {loading ? (
            <Box sx={{ p: 1 }}>
              <CircularProgress size={22} />
            </Box>
          ) : err ? (
            <Typography color='error'>{err}</Typography>
          ) : (
            <InventoryTree
              selected={selection}
              onSelect={setSelection}
              onRefreshRef={handleRefreshRef}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              onAllVmsChange={setRawVms}
              onHostsChange={setHosts}
              onPoolsChange={setPools}
              onTagsChange={setTags}
              onPbsServersChange={setPbsServers}
              favorites={favorites}
              onToggleFavorite={toggleFavorite}
              migratingVmIds={migratingVmIds}
              onRefresh={() => refreshTree?.()}
              refreshLoading={loading}
              onCollapse={() => setIsTreeCollapsed(!isTreeCollapsed)}
              isCollapsed={isTreeCollapsed}
            />
          )}
        </Box>
        )}
      </Card>

      {/* RESIZER - visible uniquement sur desktop et quand la tree n'est pas collapsed */}
      <Box
        onMouseDown={isTreeCollapsed ? undefined : handleMouseDown}
        sx={{
          display: { xs: 'none', lg: isTreeCollapsed ? 'none' : 'flex' },
          alignItems: 'center',
          justifyContent: 'center',
          width: 12,
          cursor: isTreeCollapsed ? 'default' : 'col-resize',
          flexShrink: 0,
          '&:hover': {
            '& .resizer-handle': {
              bgcolor: 'primary.main',
              opacity: 0.5,
            }
          },
          ...(isResizing && {
            '& .resizer-handle': {
              bgcolor: 'primary.main',
              opacity: 0.7,
            }
          })
        }}
      >
        <Box
          className="resizer-handle"
          sx={{
            width: 4,
            height: 48,
            borderRadius: 2,
            bgcolor: 'divider',
            transition: 'background-color 0.15s, opacity 0.15s',
          }}
        />
      </Box>

      {/* RIGHT: Details */}
      <Card
        variant='outlined'
        sx={{
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          width: '100%',
        }}
      >
        {/* Contenu scrollable */}
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <InventoryDetails 
            selection={selection} 
            onSelect={setSelection}
            onBack={() => setSelection(null)}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            allVms={allVms}
            hosts={hosts}
            pools={pools}
            tags={tags}
            pbsServers={pbsServers}
            showIpSnap={ipSnapLoaded}
            ipSnapLoading={ipSnapLoading}
            onLoadIpSnap={loadIpSnap}
            favorites={favorites}
            onToggleFavorite={toggleFavorite}
            migratingVmIds={migratingVmIds}
            onRefresh={async () => {
              if (refreshTree) {
                refreshTree()

                // Attendre un peu pour que le refresh soit traité
                await new Promise(resolve => setTimeout(resolve, 500))
              }
            }}
          />
        </Box>
      </Card>
    </Box>
  )
}
