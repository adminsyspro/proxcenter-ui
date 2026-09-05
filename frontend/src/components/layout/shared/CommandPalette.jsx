'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'

import { useRouter } from 'next/navigation'

import {
  Box,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  InputBase,
  Typography
} from '@mui/material'

import { useTranslations } from 'next-intl'

import { menuData } from '@/@menu/menuData'
import { useRBAC } from '@/contexts/RBACContext'
import { hasInfraScope } from '@/lib/rbac/scopeKinds'
import { useLicense } from '@/contexts/LicenseContext'
import { useTenant } from '@/contexts/TenantContext'
import { useMyVdcs } from '@/hooks/useMyVdcs'
import { commandPaletteRowSx } from './commandPaletteRowSx'
import { fuzzyMatch, matchGuest, matchNode } from './commandPaletteMatch'
import { NodeIcon, StatusIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'

// ---------------------------------------------------------------------------
// VM status helpers
// ---------------------------------------------------------------------------
const statusColor = (status) => {
  switch (status) {
    case 'running':
    case 'online': return '#4caf50'
    case 'stopped':
    case 'offline': return '#f44336'
    default: return '#9e9e9e'
  }
}

// While the server's address index warms up (first /api/v1/vms call of the
// process), the palette re-polls the list this many times, this often.
const WARMUP_MAX_POLLS = 5
const WARMUP_POLL_MS = 4000

// ---------------------------------------------------------------------------
// Why did this row match? Shown only for IP, MAC and notes hits: name and
// vmid are already on the row (#223, #861).
// ---------------------------------------------------------------------------
const MatchHint = ({ item, active, tCmd }) => {
  if (!item.hit || (item.via !== 'ip' && item.via !== 'mac' && item.via !== 'description')) return null

  const label = item.via === 'ip' ? 'IP' : item.via === 'mac' ? 'MAC' : tCmd('notes')
  const stale = item.via === 'ip' && Array.isArray(item.staleIps) && item.staleIps.includes(item.hit)
    ? ` • ${tCmd('lastKnownIp')}`
    : ''

  return (
    <Typography
      variant='caption'
      sx={{
        display: 'block',
        opacity: active ? 0.9 : 0.6,
        fontSize: '0.65rem',
        fontFamily: item.via === 'description' ? undefined : '"JetBrains Mono", monospace',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }}
    >
      <Box component='span' sx={{ opacity: 0.7, mr: 0.75 }}>{label}</Box>
      {item.hit}{stale}
    </Typography>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
const CommandPalette = ({ open, onClose }) => {
  const router = useRouter()
  const t = useTranslations()
  const tCmd = useTranslations('commandPalette')
  const { hasAnyPermission, scopeTypes, isAdmin, loading: rbacLoading } = useRBAC()
  const { hasFeature, loading: licenseLoading } = useLicense()
  const { currentTenant, loading: tenantLoading } = useTenant()
  const { hasVdc, loading: vdcLoading } = useMyVdcs()
  const isProviderTenant = currentTenant?.id === 'default'
  const infraScoped = hasInfraScope(scopeTypes, isAdmin)

  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [vms, setVms] = useState([])
  const [vmsLoading, setVmsLoading] = useState(false)
  const [nodes, setNodes] = useState([])
  const [pbsServers, setPbsServers] = useState([])
  const [infraLoading, setInfraLoading] = useState(false)
  const vmsCacheRef = useRef({ data: null, timestamp: 0 })
  const infraCacheRef = useRef({ data: null, timestamp: 0 })
  const warmupTimerRef = useRef(null)

  const resultsContainerRef = useRef(null)
  const itemRefs = useRef([])

  // Reset state when dialog opens / closes
  useEffect(() => {
    // Flipped by the cleanup: a response landing after the palette closed
    // must neither touch state nor schedule another poll.
    const active = { current: true }

    if (open) {
      setQuery('')
      setActiveIndex(0)

      // Fetch VMs with 60s cache
      const cache = vmsCacheRef.current
      const now = Date.now()

      // The server builds its address index in the background on the first
      // call (#223): while it says it is still warming, poll a few more times
      // so IP and MAC search works without closing the palette. A response
      // that lands after the palette closed only feeds the cache.
      const loadVms = (attempt) => {
        const firstPass = attempt === 0
        if (firstPass) setVmsLoading(true)
        fetch('/api/v1/vms')
          .then(res => res.ok ? res.json() : null)
          .then(json => {
            if (!json) {
              if (firstPass && active.current) setVms([])

              return
            }

            const vmList = json?.data?.vms || json?.data || []
            const list = Array.isArray(vmList) ? vmList : []
            const warming = Boolean(json?.data?.ipIndexWarming)

            vmsCacheRef.current = { data: list, timestamp: Date.now(), warming }
            if (!active.current) return
            setVms(list)

            if (warming && attempt < WARMUP_MAX_POLLS) {
              warmupTimerRef.current = setTimeout(() => loadVms(attempt + 1), WARMUP_POLL_MS)
            }
          })
          .catch(() => { if (firstPass && active.current) setVms([]) })
          .finally(() => { if (firstPass && active.current) setVmsLoading(false) })
      }

      // A cached list fetched while the index was warming has no live IPs: refetch it.
      if (cache.data && !cache.warming && now - cache.timestamp < 60000) {
        setVms(cache.data)
      } else {
        loadVms(0)
      }

      // Fetch nodes & PBS servers with 60s cache
      const infraCache = infraCacheRef.current

      if (infraCache.data && now - infraCache.timestamp < 60000) {
        setNodes(infraCache.data.nodes)
        setPbsServers(infraCache.data.pbsServers)
      } else {
        setInfraLoading(true)
        fetch('/api/v1/inventory')
          .then(res => res.ok ? res.json() : null)
          .then(json => {
            if (!json?.data) {
              setNodes([])
              setPbsServers([])

              return
            }

            // Flatten clusters[].nodes[] with connId/connName from parent cluster
            const nodeList = (json.data.clusters || []).flatMap(cluster =>
              (cluster.nodes || []).map(node => ({
                ...node,
                connId: cluster.id,
                connName: cluster.name
              }))
            )

            const pbsList = json.data.pbsServers || []

            infraCacheRef.current = { data: { nodes: nodeList, pbsServers: pbsList }, timestamp: Date.now() }
            setNodes(nodeList)
            setPbsServers(pbsList)
          })
          .catch(() => { setNodes([]); setPbsServers([]) })
          .finally(() => setInfraLoading(false))
      }
    }

    return () => {
      active.current = false
      if (warmupTimerRef.current) {
        clearTimeout(warmupTimerRef.current)
        warmupTimerRef.current = null
      }
    }
  }, [open])

  // -----------------------------------------------------------------------
  // 1. Pages — flatten menuData, filter by RBAC + License
  // -----------------------------------------------------------------------
  const pages = useMemo(() => {
    const items = []
    const data = menuData(t)

    // Mirror GenerateMenu.canView: while contexts are loading we keep
    // everything visible to avoid flickering; once loaded we apply the same
    // five gates (vdc / provider-tenant / infra-scope / RBAC / license) the
    // sidebar uses. The infra-scope gate matters: a tag or pool scoped user
    // keeps vm.view, so without it Topology stayed reachable from the palette
    // and bounced straight back to the dashboard (issue #633).
    const canView = (entry) => {
      if (rbacLoading || licenseLoading || tenantLoading || vdcLoading) return true
      if (entry.requires?.hasVdc === true && !hasVdc) return false
      if (entry.requires?.hasVdc === false && hasVdc) return false
      if (entry.requires?.isProviderTenant === true && !isProviderTenant) return false
      if (entry.requires?.infraScope === true && !infraScoped) return false
      if (entry.permissions && entry.permissions.length > 0 && !hasAnyPermission(entry.permissions)) return false
      if (entry.requiredFeature && !hasFeature(entry.requiredFeature)) return false

      return true
    }

    // Section visibility predicate — kept narrower than `canView` to match
    // the vertical menu (GenerateMenu.jsx). The section's own
    // `requiredFeature` and `requires.isProviderTenant` MUST NOT gate the
    // children: a child carries its own flag (e.g. Site Recovery has
    // requiredFeature='ceph_replication') and would otherwise vanish from
    // the palette whenever the section's parent flag — say DRS on the
    // Orchestration section — happens to be unlicensed. Only the section's
    // explicit `permissions` array still gates here because that mirrors
    // the menu's own section-level check.
    const sectionAllowed = (section) => {
      if (rbacLoading) return true
      if (section.permissions && section.permissions.length > 0 && !hasAnyPermission(section.permissions)) return false
      return true
    }

    for (const entry of data) {
      // Top-level page (no section)
      if (!entry.isSection && entry.href) {
        if (!canView(entry)) continue
        items.push({ type: 'page', label: entry.label, icon: entry.icon, href: entry.href })
        continue
      }

      // Section with children
      if (entry.isSection && entry.children) {
        if (!sectionAllowed(entry)) continue

        for (const child of entry.children) {
          if (!canView(child)) continue
          items.push({ type: 'page', label: child.label, icon: child.icon, href: child.href })
        }
      }
    }

    return items
  }, [t, hasAnyPermission, hasFeature, hasVdc, isProviderTenant, infraScoped, rbacLoading, licenseLoading, tenantLoading, vdcLoading])

  // -----------------------------------------------------------------------
  // 2. Actions — static list filtered by RBAC/License
  // -----------------------------------------------------------------------
  const actions = useMemo(() => {
    const all = [
      { type: 'action', label: tCmd('goToSettings'), icon: 'ri-settings-3-line', href: '/settings', permission: 'connection.manage' },
      // Same gate as the settings API tab it documents (#827): super admin in
      // the provider tenant. Not license-gated, the reference is documentation.
      { type: 'action', label: tCmd('goToApiReference'), icon: 'ri-book-2-line', href: '/settings/api-reference', superAdminProviderOnly: true },
      { type: 'action', label: tCmd('viewBackups'), icon: 'ri-file-copy-fill', href: '/operations/backups', permission: 'backup.view' },
      { type: 'action', label: tCmd('viewEvents'), icon: 'ri-calendar-event-line', href: '/operations/events' },
      { type: 'action', label: tCmd('viewAlerts'), icon: 'ri-notification-3-line', href: '/operations/alerts' }
    ]

    return all.filter(a => {
      if (a.permission && !hasAnyPermission([a.permission])) return false
      if (a.requiredFeature && !hasFeature(a.requiredFeature)) return false
      if (a.superAdminProviderOnly && !(isAdmin && isProviderTenant)) return false

      return true
    })
  }, [tCmd, hasAnyPermission, hasFeature, isAdmin, isProviderTenant])

  // -----------------------------------------------------------------------
  // 3. Filtered results — fuzzy search across all 3 sources
  // -----------------------------------------------------------------------
  const { filteredPages, filteredVms, filteredNodes, filteredPbs, filteredActions, flatResults } = useMemo(() => {
    const q = query.trim()

    let fPages = pages
    let fVms = []
    let fNodes = []
    let fPbs = []
    let fActions = actions

    if (q) {
      fPages = pages
        .map(p => ({ ...p, ...fuzzyMatch(q, p.label) }))
        .filter(p => p.match)
        .sort((a, b) => b.score - a.score)

      fVms = vms
        .map(vm => ({ ...vm, ...matchGuest(q, vm) }))
        .filter(vm => vm.match)
        .sort((a, b) => b.score - a.score)

      fNodes = nodes
        .map(n => ({ ...n, ...matchNode(q, n) }))
        .filter(n => n.match)
        .sort((a, b) => b.score - a.score)

      fPbs = pbsServers
        .map(p => ({ ...p, ...fuzzyMatch(q, p.name || '') }))
        .filter(p => p.match)
        .sort((a, b) => b.score - a.score)

      fActions = actions
        .map(a => ({ ...a, ...fuzzyMatch(q, a.label) }))
        .filter(a => a.match)
        .sort((a, b) => b.score - a.score)
    }

    // Cap sections for performance
    fPages = fPages.slice(0, 10)
    fVms = fVms.slice(0, 20)
    fNodes = fNodes.slice(0, 10)
    fPbs = fPbs.slice(0, 5)
    fActions = fActions.slice(0, 10)

    // Flat array for keyboard nav
    const flat = [
      ...fPages.map(p => ({ ...p, _type: 'page' })),
      ...fVms.map(vm => ({ ...vm, _type: 'vm' })),
      ...fNodes.map(n => ({ ...n, _type: 'node' })),
      ...fPbs.map(p => ({ ...p, _type: 'pbs' })),
      ...fActions.map(a => ({ ...a, _type: 'action' }))
    ]

    return { filteredPages: fPages, filteredVms: fVms, filteredNodes: fNodes, filteredPbs: fPbs, filteredActions: fActions, flatResults: flat }
  }, [query, pages, vms, nodes, pbsServers, actions])

  // Reset activeIndex when results change
  useEffect(() => {
    setActiveIndex(0)
  }, [flatResults.length])

  // -----------------------------------------------------------------------
  // Navigate to the selected result
  // -----------------------------------------------------------------------
  const navigateTo = useCallback((item) => {
    if (!item) return

    if (item._type === 'vm' || item.type === 'vm') {
      const connId = item.connectionId || item.connId || ''
      const node = item.node || ''
      const vmType = item.type === 'vm' ? 'qemu' : (item.type || 'qemu')
      const params = new URLSearchParams({ vmid: String(item.vmid), connId, node, type: vmType })
      router.push(`/infrastructure/inventory?${params.toString()}`)
    } else if (item._type === 'node') {
      const selectId = `${item.connId}:${item.node}`
      router.push(`/infrastructure/inventory?selectType=node&selectId=${encodeURIComponent(selectId)}`)
    } else if (item._type === 'pbs') {
      router.push(`/infrastructure/inventory?selectType=pbs&selectId=${encodeURIComponent(item.id)}`)
    } else {
      router.push(item.href)
    }

    onClose()
  }, [router, onClose])

  // -----------------------------------------------------------------------
  // Keyboard navigation
  // -----------------------------------------------------------------------
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(prev => {
        const next = prev + 1 >= flatResults.length ? 0 : prev + 1
        itemRefs.current[next]?.scrollIntoView({ block: 'nearest' })

        return next
      })
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(prev => {
        const next = prev - 1 < 0 ? flatResults.length - 1 : prev - 1
        itemRefs.current[next]?.scrollIntoView({ block: 'nearest' })

        return next
      })
    } else if (e.key === 'Enter') {
      e.preventDefault()

      if (flatResults[activeIndex]) {
        navigateTo(flatResults[activeIndex])
      }
    }
  }, [flatResults, activeIndex, navigateTo])

  // Track flat index for rendering
  let flatIdx = -1

  const nextIdx = () => {
    flatIdx++

    return flatIdx
  }

  const hasResults = flatResults.length > 0
  const showNoResults = query.trim() && !hasResults && !vmsLoading && !infraLoading

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth='sm'
      PaperProps={{
        sx: {
          borderRadius: 3,
          overflow: 'hidden'
        }
      }}
    >
      {/* Search input header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: 2.5,
          py: 1.5,
          borderBottom: '1px solid',
          borderColor: 'divider'
        }}
      >
        <i className='ri-search-line' style={{ fontSize: 20, opacity: 0.5 }} />
        <InputBase
          autoFocus
          fullWidth
          placeholder={tCmd('placeholder')}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          sx={{ fontSize: '0.95rem' }}
        />
        <Chip
          size='small'
          label='ESC'
          variant='outlined'
          onClick={onClose}
          sx={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.65rem' }}
        />
      </Box>

      {/* Results area */}
      <Box
        ref={resultsContainerRef}
        sx={{
          maxHeight: 400,
          overflowY: 'auto',
          py: 1
        }}
      >
        {/* Loading VMs indicator */}
        {vmsLoading && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2.5, py: 1 }}>
            <CircularProgress size={14} />
            <Typography variant='caption' sx={{ opacity: 0.6 }}>
              {tCmd('loadingVms')}
            </Typography>
          </Box>
        )}

        {/* PAGES section */}
        {filteredPages.length > 0 && (
          <>
            <Typography
              variant='overline'
              sx={{
                px: 2.5,
                py: 0.5,
                display: 'block',
                opacity: 0.5,
                fontSize: '0.65rem',
                letterSpacing: 1.2,
                fontWeight: 700
              }}
            >
              {tCmd('pages')}
            </Typography>
            {filteredPages.map((page, i) => {
              const idx = nextIdx()

              return (
                <Box
                  key={`page-${page.href}`}
                  ref={el => { itemRefs.current[idx] = el }}
                  onClick={() => navigateTo({ ...page, _type: 'page' })}
                  sx={commandPaletteRowSx(activeIndex === idx)}
                >
                  <i
                    className={page.icon || 'ri-file-line'}
                    style={{
                      fontSize: 18,
                      opacity: activeIndex === idx ? 1 : 0.6
                    }}
                  />
                  <Typography variant='body2' sx={{ fontWeight: 500 }}>
                    {page.label}
                  </Typography>
                </Box>
              )
            })}
          </>
        )}

        {/* VIRTUAL MACHINES section */}
        {filteredVms.length > 0 && (
          <>
            <Typography
              variant='overline'
              sx={{
                px: 2.5,
                py: 0.5,
                mt: 1,
                display: 'block',
                opacity: 0.5,
                fontSize: '0.65rem',
                letterSpacing: 1.2,
                fontWeight: 700
              }}
            >
              {tCmd('virtualMachines')}
            </Typography>
            {filteredVms.map((vm, i) => {
              const idx = nextIdx()

              return (
                <Box
                  key={`vm-${vm.vmid}-${vm.node}`}
                  ref={el => { itemRefs.current[idx] = el }}
                  onClick={() => navigateTo({ ...vm, _type: 'vm' })}
                  sx={commandPaletteRowSx(activeIndex === idx)}
                >
                  {/* Same guest icon and status badge as the inventory tree */}
                  <StatusIcon status={vm.status} type='vm' template={vm.template} vmType={vm.type} lock={vm.lock} size={18} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography
                        variant='body2'
                        sx={{
                          fontWeight: 500,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {vm.name || `VM ${vm.vmid}`}
                      </Typography>
                      <Typography
                        variant='caption'
                        sx={{
                          opacity: activeIndex === idx ? 0.8 : 0.5,
                          fontSize: '0.7rem',
                          fontFamily: '"JetBrains Mono", monospace'
                        }}
                      >
                        ({vm.vmid})
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Typography
                        variant='caption'
                        sx={{
                          opacity: activeIndex === idx ? 0.8 : 0.5,
                          fontSize: '0.65rem'
                        }}
                      >
                        {vm.status}
                      </Typography>
                      {(vm.connectionName || vm.node) && (
                        <>
                          <Typography
                            component='span'
                            sx={{
                              opacity: activeIndex === idx ? 0.6 : 0.3,
                              fontSize: '0.6rem'
                            }}
                          >
                            •
                          </Typography>
                          <Typography
                            variant='caption'
                            sx={{
                              opacity: activeIndex === idx ? 0.8 : 0.5,
                              fontSize: '0.65rem'
                            }}
                          >
                            {vm.connectionName || vm.node}
                          </Typography>
                        </>
                      )}
                    </Box>
                    <MatchHint item={vm} active={activeIndex === idx} tCmd={tCmd} />
                  </Box>
                </Box>
              )
            })}
          </>
        )}

        {/* NODES section */}
        {filteredNodes.length > 0 && (
          <>
            <Typography
              variant='overline'
              sx={{
                px: 2.5,
                py: 0.5,
                mt: 1,
                display: 'block',
                opacity: 0.5,
                fontSize: '0.65rem',
                letterSpacing: 1.2,
                fontWeight: 700
              }}
            >
              {tCmd('nodes')}
            </Typography>
            {filteredNodes.map((node, i) => {
              const idx = nextIdx()

              return (
                <Box
                  key={`node-${node.connId}-${node.node}`}
                  ref={el => { itemRefs.current[idx] = el }}
                  onClick={() => navigateTo({ ...node, _type: 'node' })}
                  sx={commandPaletteRowSx(activeIndex === idx)}
                >
                  <NodeIcon status={node.status} maintenance={node.maintenance} size={18} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography
                        variant='body2'
                        sx={{
                          fontWeight: 500,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {node.node}
                      </Typography>
                    </Box>
                    {node.connName && (
                      <Typography
                        variant='caption'
                        sx={{
                          opacity: activeIndex === idx ? 0.8 : 0.5,
                          fontSize: '0.65rem'
                        }}
                      >
                        {node.connName}
                      </Typography>
                    )}
                    <MatchHint item={node} active={activeIndex === idx} tCmd={tCmd} />
                  </Box>
                </Box>
              )
            })}
          </>
        )}

        {/* PBS SERVERS section */}
        {filteredPbs.length > 0 && (
          <>
            <Typography
              variant='overline'
              sx={{
                px: 2.5,
                py: 0.5,
                mt: 1,
                display: 'block',
                opacity: 0.5,
                fontSize: '0.65rem',
                letterSpacing: 1.2,
                fontWeight: 700
              }}
            >
              {tCmd('pbsServers')}
            </Typography>
            {filteredPbs.map((pbs, i) => {
              const idx = nextIdx()

              return (
                <Box
                  key={`pbs-${pbs.id}`}
                  ref={el => { itemRefs.current[idx] = el }}
                  onClick={() => navigateTo({ ...pbs, _type: 'pbs' })}
                  sx={commandPaletteRowSx(activeIndex === idx)}
                >
                  <i
                    className='ri-shield-check-line'
                    style={{
                      fontSize: 18,
                      opacity: activeIndex === idx ? 1 : 0.6
                    }}
                  />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography
                        variant='body2'
                        sx={{
                          fontWeight: 500,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {pbs.name}
                      </Typography>
                      <Box
                        sx={{
                          width: 7,
                          height: 7,
                          borderRadius: '50%',
                          bgcolor: statusColor(pbs.status),
                          flexShrink: 0
                        }}
                      />
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      {pbs.version && (
                        <Typography
                          variant='caption'
                          sx={{
                            opacity: activeIndex === idx ? 0.8 : 0.5,
                            fontSize: '0.65rem',
                            fontFamily: '"JetBrains Mono", monospace'
                          }}
                        >
                          v{pbs.version}
                        </Typography>
                      )}
                      {pbs.stats?.datastoreCount > 0 && (
                        <>
                          {pbs.version && (
                            <Typography
                              component='span'
                              sx={{
                                opacity: activeIndex === idx ? 0.6 : 0.3,
                                fontSize: '0.6rem'
                              }}
                            >
                              •
                            </Typography>
                          )}
                          <Typography
                            variant='caption'
                            sx={{
                              opacity: activeIndex === idx ? 0.8 : 0.5,
                              fontSize: '0.65rem'
                            }}
                          >
                            {pbs.stats.datastoreCount} datastore{pbs.stats.datastoreCount > 1 ? 's' : ''}
                          </Typography>
                        </>
                      )}
                    </Box>
                  </Box>
                </Box>
              )
            })}
          </>
        )}

        {/* ACTIONS section */}
        {filteredActions.length > 0 && (
          <>
            <Typography
              variant='overline'
              sx={{
                px: 2.5,
                py: 0.5,
                mt: 1,
                display: 'block',
                opacity: 0.5,
                fontSize: '0.65rem',
                letterSpacing: 1.2,
                fontWeight: 700
              }}
            >
              {tCmd('actions')}
            </Typography>
            {filteredActions.map((action, i) => {
              const idx = nextIdx()

              return (
                <Box
                  key={`action-${action.href}`}
                  ref={el => { itemRefs.current[idx] = el }}
                  onClick={() => navigateTo({ ...action, _type: 'action' })}
                  sx={commandPaletteRowSx(activeIndex === idx)}
                >
                  <i
                    className={action.icon}
                    style={{
                      fontSize: 18,
                      opacity: activeIndex === idx ? 1 : 0.6
                    }}
                  />
                  <Typography variant='body2' sx={{ fontWeight: 500 }}>
                    {action.label}
                  </Typography>
                </Box>
              )
            })}
          </>
        )}

        {/* No results */}
        {showNoResults && (
          <Box sx={{ py: 4, textAlign: 'center' }}>
            <i
              className='ri-search-line'
              style={{ fontSize: 32, opacity: 0.3 }}
            />
            <Typography variant='body2' sx={{ mt: 1, fontWeight: 600, opacity: 0.7 }}>
              {tCmd('noResults')}
            </Typography>
            <Typography variant='caption' sx={{ opacity: 0.5 }}>
              {tCmd('noResultsDesc')}
            </Typography>
          </Box>
        )}
      </Box>

      {/* Footer with keyboard hints */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          px: 2.5,
          py: 1,
          borderTop: '1px solid',
          borderColor: 'divider',
          bgcolor: theme => theme.palette.action.hover
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Chip size='small' label='↑↓' variant='outlined' sx={{ height: 20, fontSize: '0.6rem', fontWeight: 700 }} />
          <Typography variant='caption' sx={{ opacity: 0.5, fontSize: '0.65rem' }}>
            {tCmd('navigate')}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Chip size='small' label='↵' variant='outlined' sx={{ height: 20, fontSize: '0.6rem', fontWeight: 700 }} />
          <Typography variant='caption' sx={{ opacity: 0.5, fontSize: '0.65rem' }}>
            {tCmd('select')}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Chip size='small' label='esc' variant='outlined' sx={{ height: 20, fontSize: '0.6rem', fontWeight: 700 }} />
          <Typography variant='caption' sx={{ opacity: 0.5, fontSize: '0.65rem' }}>
            {tCmd('close')}
          </Typography>
        </Box>
      </Box>
    </Dialog>
  )
}

export default CommandPalette
