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
import { useLicense } from '@/contexts/LicenseContext'

// ---------------------------------------------------------------------------
// Fuzzy match utility (no external lib)
// ---------------------------------------------------------------------------
function fuzzyMatch(query, text) {
  const lowerQuery = query.toLowerCase()
  const lowerText = text.toLowerCase()

  // Exact substring = highest score
  if (lowerText.includes(lowerQuery)) {
    const index = lowerText.indexOf(lowerQuery)

    return { match: true, score: 100 - index + (lowerQuery.length / lowerText.length) * 50 }
  }

  // Character-by-character with word-start bonus
  let qi = 0
  let score = 0

  for (let ti = 0; ti < lowerText.length && qi < lowerQuery.length; ti++) {
    if (lowerText[ti] === lowerQuery[qi]) {
      score += (ti === 0 || lowerText[ti - 1] === ' ' || lowerText[ti - 1] === '-') ? 10 : 1
      qi++
    }
  }

  if (qi === lowerQuery.length) return { match: true, score }

  return { match: false, score: 0 }
}

// ---------------------------------------------------------------------------
// VM status helpers
// ---------------------------------------------------------------------------
const statusColor = (status) => {
  switch (status) {
    case 'running': return '#4caf50'
    case 'stopped': return '#f44336'
    default: return '#9e9e9e'
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
const CommandPalette = ({ open, onClose }) => {
  const router = useRouter()
  const t = useTranslations()
  const tCmd = useTranslations('commandPalette')
  const { hasAnyPermission } = useRBAC()
  const { hasFeature } = useLicense()

  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [vms, setVms] = useState([])
  const [vmsLoading, setVmsLoading] = useState(false)
  const vmsCacheRef = useRef({ data: null, timestamp: 0 })

  const resultsContainerRef = useRef(null)
  const itemRefs = useRef([])

  // Reset state when dialog opens / closes
  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)

      // Fetch VMs with 60s cache
      const cache = vmsCacheRef.current
      const now = Date.now()

      if (cache.data && now - cache.timestamp < 60000) {
        setVms(cache.data)
      } else {
        setVmsLoading(true)
        fetch('/api/v1/vms')
          .then(res => res.ok ? res.json() : null)
          .then(json => {
            if (!json) return setVms([])
            const vmList = json?.data?.vms || json?.data || []
            vmsCacheRef.current = { data: Array.isArray(vmList) ? vmList : [], timestamp: Date.now() }
            setVms(Array.isArray(vmList) ? vmList : [])
          })
          .catch(() => setVms([]))
          .finally(() => setVmsLoading(false))
      }
    }
  }, [open])

  // -----------------------------------------------------------------------
  // 1. Pages — flatten menuData, filter by RBAC + License
  // -----------------------------------------------------------------------
  const pages = useMemo(() => {
    const items = []
    const data = menuData(t)

    for (const entry of data) {
      // Top-level page (no section)
      if (!entry.isSection && entry.href) {
        items.push({ type: 'page', label: entry.label, icon: entry.icon, href: entry.href })
        continue
      }

      // Section with children
      if (entry.isSection && entry.children) {
        // Check section-level gating
        if (entry.permissions && !hasAnyPermission(entry.permissions)) continue
        if (entry.requiredFeature && !hasFeature(entry.requiredFeature)) continue

        for (const child of entry.children) {
          if (child.permissions && !hasAnyPermission(child.permissions)) continue
          if (child.requiredFeature && !hasFeature(child.requiredFeature)) continue
          items.push({ type: 'page', label: child.label, icon: child.icon, href: child.href })
        }
      }
    }

    return items
  }, [t, hasAnyPermission, hasFeature])

  // -----------------------------------------------------------------------
  // 2. Actions — static list filtered by RBAC/License
  // -----------------------------------------------------------------------
  const actions = useMemo(() => {
    const all = [
      { type: 'action', label: tCmd('goToSettings'), icon: 'ri-settings-3-line', href: '/settings', permission: 'connection.manage' },
      { type: 'action', label: tCmd('viewBackups'), icon: 'ri-file-copy-fill', href: '/operations/backups', permission: 'backup.view' },
      { type: 'action', label: tCmd('viewEvents'), icon: 'ri-calendar-event-line', href: '/operations/events' },
      { type: 'action', label: tCmd('viewAlerts'), icon: 'ri-notification-3-line', href: '/operations/alerts' }
    ]

    return all.filter(a => {
      if (a.permission && !hasAnyPermission([a.permission])) return false
      if (a.requiredFeature && !hasFeature(a.requiredFeature)) return false

      return true
    })
  }, [tCmd, hasAnyPermission, hasFeature])

  // -----------------------------------------------------------------------
  // 3. Filtered results — fuzzy search across all 3 sources
  // -----------------------------------------------------------------------
  const { filteredPages, filteredVms, filteredActions, flatResults } = useMemo(() => {
    const q = query.trim()

    let fPages = pages
    let fVms = vms
    let fActions = actions

    if (q) {
      fPages = pages
        .map(p => ({ ...p, ...fuzzyMatch(q, p.label) }))
        .filter(p => p.match)
        .sort((a, b) => b.score - a.score)

      fVms = vms
        .map(vm => {
          const nameMatch = fuzzyMatch(q, vm.name || '')
          const vmidMatch = fuzzyMatch(q, String(vm.vmid || ''))
          const best = nameMatch.score >= vmidMatch.score ? nameMatch : vmidMatch

          return { ...vm, ...best }
        })
        .filter(vm => vm.match)
        .sort((a, b) => b.score - a.score)

      fActions = actions
        .map(a => ({ ...a, ...fuzzyMatch(q, a.label) }))
        .filter(a => a.match)
        .sort((a, b) => b.score - a.score)
    }

    // Cap each section at 10
    fPages = fPages.slice(0, 10)
    fVms = fVms.slice(0, 10)
    fActions = fActions.slice(0, 10)

    // Flat array for keyboard nav
    const flat = [
      ...fPages.map(p => ({ ...p, _type: 'page' })),
      ...fVms.map(vm => ({ ...vm, _type: 'vm' })),
      ...fActions.map(a => ({ ...a, _type: 'action' }))
    ]

    return { filteredPages: fPages, filteredVms: fVms, filteredActions: fActions, flatResults: flat }
  }, [query, pages, vms, actions])

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
      router.push(`/infrastructure/inventory?vmid=${item.vmid}`)
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
  const showNoResults = query.trim() && !hasResults && !vmsLoading

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
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    px: 2.5,
                    py: 1,
                    cursor: 'pointer',
                    borderRadius: 1,
                    mx: 1,
                    bgcolor: activeIndex === idx ? 'primary.main' : 'transparent',
                    color: activeIndex === idx ? 'primary.contrastText' : 'text.primary',
                    '&:hover': {
                      bgcolor: activeIndex === idx ? 'primary.main' : 'action.hover'
                    },
                    transition: 'background-color 0.1s'
                  }}
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
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    px: 2.5,
                    py: 1,
                    cursor: 'pointer',
                    borderRadius: 1,
                    mx: 1,
                    bgcolor: activeIndex === idx ? 'primary.main' : 'transparent',
                    color: activeIndex === idx ? 'primary.contrastText' : 'text.primary',
                    '&:hover': {
                      bgcolor: activeIndex === idx ? 'primary.main' : 'action.hover'
                    },
                    transition: 'background-color 0.1s'
                  }}
                >
                  {/* Status dot */}
                  <Box
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      bgcolor: statusColor(vm.status),
                      flexShrink: 0
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
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    px: 2.5,
                    py: 1,
                    cursor: 'pointer',
                    borderRadius: 1,
                    mx: 1,
                    bgcolor: activeIndex === idx ? 'primary.main' : 'transparent',
                    color: activeIndex === idx ? 'primary.contrastText' : 'text.primary',
                    '&:hover': {
                      bgcolor: activeIndex === idx ? 'primary.main' : 'action.hover'
                    },
                    transition: 'background-color 0.1s'
                  }}
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
