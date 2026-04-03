'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useTranslations } from 'next-intl'
import { ResponsiveGridLayout } from 'react-grid-layout'

import {
  Box, Card, CardContent, CircularProgress, IconButton, Menu, MenuItem,
  Skeleton, Tooltip, Typography, Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Chip, Tabs, Tab, Snackbar, Alert, useTheme, TextField, ListItemIcon, ListItemText, Divider
} from '@mui/material'

import { WIDGET_REGISTRY, WIDGET_CATEGORIES, getWidgetsByCategory } from './widgetRegistry'
import { DEFAULT_LAYOUT, PRESET_LAYOUTS } from './types'
import { CardsSkeleton } from '@/components/skeletons'

const GRID_COLS = { lg: 12, md: 12, sm: 12, xs: 12, xxs: 12 }
const ROW_HEIGHT = 40
const MARGIN = [6, 4]

const TIME_RANGES = [
  { value: 'hour', label: '1h' },
  { value: '6h', label: '6h' },
  { value: 'day', label: '24h' },
  { value: 'week', label: '7d' },
  { value: 'month', label: '30d' },
]

// Génère un ID unique
function generateId() {
  return `widget-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

// Composant Widget Container
// No-container wrapper
function NoContainerWrapper({ config, data, loading, editMode, onRemove, onUpdateSettings, widgetDef, widgetName, WidgetComponent, timeRange, t }) {
  return (
    <Box sx={{
      height: '100%', position: 'relative', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      ...(editMode && {
        border: '2px dashed',
        borderColor: 'primary.main',
        borderRadius: 3,
        opacity: 0.9,
      }),
    }}>
      {editMode && (
        <Box
          className="widget-drag-handle"
          sx={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            px: 1.5, py: 0.5,
            bgcolor: 'primary.main', color: 'primary.contrastText',
            cursor: 'move', flexShrink: 0,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            <i className={widgetDef.icon} style={{ fontSize: 14 }} />
            <Typography variant='caption' sx={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {widgetName}
            </Typography>
          </Box>
          <Tooltip title={t('common.delete')}>
            <IconButton size='small' onClick={onRemove} sx={{ p: 0.25, color: 'inherit' }}>
              <i className='ri-close-line' style={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        </Box>
      )}
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {loading ? (
          <Box sx={{ height: '100%', p: 0.5 }}>
            <Skeleton variant="rounded" width="100%" height="100%" sx={{ borderRadius: 0.5 }} />
          </Box>
        ) : (
          <WidgetComponent config={config} data={data} loading={loading} onUpdateSettings={onUpdateSettings} timeRange={timeRange} />
        )}
      </Box>
    </Box>
  )
}

function WidgetContainer({
  config,
  data,
  loading,
  editMode,
  onRemove,
  onUpdateSettings,
  timeRange,
  t,
}) {
  const widgetDef = WIDGET_REGISTRY[config.type]
  const WidgetComponent = widgetDef?.component

  // Get translated widget name
  const widgetNameKey = config.type.replace(/-([a-z])/g, (m, c) => c.toUpperCase())
  const widgetName = t(`dashboard.widgetNames.${widgetNameKey}`, { defaultValue: widgetDef?.name || config.type })

  if (!WidgetComponent) {
    return (
      <Card variant='outlined' sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
        <Typography variant='caption' color='error'>{t('dashboard.unknownWidget')} {config.type}</Typography>
        <IconButton size='small' onClick={onRemove} color='error'>
          <i className='ri-delete-bin-line' style={{ fontSize: 16 }} />
        </IconButton>
      </Card>
    )
  }

  // No container mode: widget renders directly, only show edit controls as overlay
  if (widgetDef.noContainer) {
    return (
      <NoContainerWrapper
        config={config}
        data={data}
        loading={loading}
        editMode={editMode}
        onRemove={onRemove}
        onUpdateSettings={onUpdateSettings}
        widgetDef={widgetDef}
        widgetName={widgetName}
        WidgetComponent={WidgetComponent}
        timeRange={timeRange}
        t={t}
      />
    )
  }

  return (
    <Card
      elevation={0}
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
        transition: 'all 0.25s ease',
        background: 'transparent',
        border: '1px solid',
        borderColor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
        borderRadius: 3,
        '&:hover': editMode ? { boxShadow: 4 } : {},
      }}
    >
      {/* Header - zone de drag */}
      <Box
        className="widget-drag-handle"
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 1.5,
          py: 0.75,
          borderBottom: '1px solid',
          borderColor: 'divider',
          cursor: editMode ? 'move' : 'default',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <i className={widgetDef.icon} style={{ fontSize: 14, opacity: 0.7 }} />
          <Typography variant='caption' sx={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {widgetName}
          </Typography>
        </Box>
        {editMode && (
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Tooltip title={t('common.delete')}>
              <IconButton size='small' onClick={onRemove} sx={{ p: 0.25 }}>
                <i className='ri-close-line' style={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </Box>

      {/* Content */}
      <CardContent sx={{ flex: 1, p: 1, overflow: 'hidden', '&:last-child': { pb: 1 } }}>
        {loading ? (
          <Box sx={{ height: '100%', p: 0.5 }}>
            <Skeleton variant="rounded" width="100%" height="100%" sx={{ borderRadius: 0.5 }} />
          </Box>
        ) : (
          <WidgetComponent config={config} data={data} loading={loading} onUpdateSettings={onUpdateSettings} timeRange={timeRange} />
        )}
      </CardContent>
    </Card>
  )
}

// Lightweight name input dialog (own state to avoid re-rendering the grid)
function NameDialog({ open, title, label, submitLabel, initialValue = '', onClose, onSubmit }) {
  const [value, setValue] = useState(initialValue)

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus fullWidth size="small" margin="dense"
          label={label}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && value.trim() && onSubmit(value.trim())}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => onSubmit(value.trim())} disabled={!value.trim()}>{submitLabel}</Button>
      </DialogActions>
    </Dialog>
  )
}

// Dialog pour ajouter un widget
function AddWidgetDialog({ open, onClose, onAdd, t }) {
  const [tab, setTab] = useState(0)
  const categories = WIDGET_CATEGORIES

  // Get translated category name
  const getCategoryName = (cat) => t(`dashboard.categories.${cat.id}`, { defaultValue: cat.name })

  // Get translated widget name and description
  const getWidgetName = (widget) => {
    const key = widget.type.replace(/-([a-z])/g, (m, c) => c.toUpperCase())

    return t(`dashboard.widgetNames.${key}`, { defaultValue: widget.name })
  }

  const getWidgetDesc = (widget) => {
    const key = widget.type.replace(/-([a-z])/g, (m, c) => c.toUpperCase())

    return t(`dashboard.widgetDescs.${key}`, { defaultValue: widget.description })
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth='sm' fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className='ri-add-circle-line' style={{ fontSize: 20 }} />
          {t('dashboard.addWidget')}
        </Box>
      </DialogTitle>
      <DialogContent sx={{ p: 0 }}>
        <Tabs
          value={tab}
          onChange={(e, v) => setTab(v)}
          variant='scrollable'
          scrollButtons='auto'
          sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}
        >
          {categories.map((cat, idx) => (
            <Tab
              key={cat.id}
              label={getCategoryName(cat)}
              icon={<i className={cat.icon} style={{ fontSize: 16 }} />}
              iconPosition='start'
              sx={{ minHeight: 48, textTransform: 'none' }}
            />
          ))}
        </Tabs>
        <Box sx={{ p: 2 }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1.5 }}>
            {getWidgetsByCategory(categories[tab]?.id).map((widget) => (
              <Card
                key={widget.type}
                variant='outlined'
                sx={{
                  p: 1.5,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  '&:hover': { bgcolor: 'action.hover', borderColor: 'primary.main' }
                }}
                onClick={() => onAdd(widget.type)}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <i className={widget.icon} style={{ fontSize: 18, opacity: 0.7 }} />
                  <Typography variant='body2' sx={{ fontWeight: 700 }}>{getWidgetName(widget)}</Typography>
                </Box>
                <Typography variant='caption' sx={{ opacity: 0.6 }}>{getWidgetDesc(widget)}</Typography>
                <Box sx={{ mt: 1 }}>
                  <Chip
                    size='small'
                    label={`${widget.defaultSize.w}x${widget.defaultSize.h}`}
                    sx={{ height: 18, fontSize: 10 }}
                  />
                </Box>
              </Card>
            ))}
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  )
}

// Composant principal
export default function WidgetGrid({ data, loading, onRefresh, refreshLoading }) {
  const t = useTranslations()
  const theme = useTheme()
  const [layout, setLayout] = useState(DEFAULT_LAYOUT)
  const [editMode, setEditMode] = useState(false)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [layoutMenuAnchor, setLayoutMenuAnchor] = useState(null)
  const [saving, setSaving] = useState(false)
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' })
  const [layoutLoaded, setLayoutLoaded] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)

  // Multi-dashboard state
  const [dashboards, setDashboards] = useState([])
  const [currentDashboard, setCurrentDashboard] = useState('Default')
  const [dashTabAnchor, setDashTabAnchor] = useState(null)
  const [dashTabTarget, setDashTabTarget] = useState(null)
  const [newDashDialog, setNewDashDialog] = useState(false)
  const [renameDashDialog, setRenameDashDialog] = useState(false)
  const [deleteDashDialog, setDeleteDashDialog] = useState(false)
  const [dragTabName, setDragTabName] = useState(null)
  const [dragOverName, setDragOverName] = useState(null)

  const [timeRange, setTimeRange] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('dashboard-timerange') || 'hour'
    
return 'hour'
  })

  const handleTimeRangeChange = useCallback((value) => {
    setTimeRange(value)
    localStorage.setItem('dashboard-timerange', value)
  }, [])

  // Mesure de la largeur du conteneur (requis par react-grid-layout v2.x)
  const [containerWidth, setContainerWidth] = useState(1200) // Largeur par défaut
  const resizeObserverRef = useRef(null)

  const containerRef = useCallback((node) => {
    // Cleanup previous observer
    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect()
    }

    if (!node) return

    const measureWidth = () => {
      const width = node.getBoundingClientRect().width

      if (width > 0) {
        setContainerWidth(width)
      }
    }

    // Mesure immédiate
    measureWidth()

    // Observer les changements de taille
    resizeObserverRef.current = new ResizeObserver(() => {
      measureWidth()
    })

    resizeObserverRef.current.observe(node)
  }, [])

  // Load dashboard list + active dashboard
  const loadDashboard = useCallback(async (name) => {
    try {
      const url = name ? `/api/v1/dashboard/layout?name=${encodeURIComponent(name)}` : '/api/v1/dashboard/layout'
      const res = await fetch(url)

      if (res.ok) {
        const json = await res.json()

        if (json.data?.widgets && Array.isArray(json.data.widgets)) {
          const cleaned = json.data.widgets.filter(w => WIDGET_REGISTRY[w.type])

          // Only fallback to DEFAULT_LAYOUT if this is the "Default" dashboard with no saved data
          setLayout(json.data.id ? cleaned : (cleaned.length > 0 ? cleaned : DEFAULT_LAYOUT.map(w => ({ ...w, id: generateId() }))))
          setCurrentDashboard(json.data.name || 'Default')
        }
      }
    } catch (e) {
      console.error('Failed to load dashboard:', e)
    }
  }, [])

  const refreshDashboardList = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/dashboard/layout?list=true')

      if (res.ok) {
        const json = await res.json()

        setDashboards(json.data || [])
      }
    } catch {}
  }, [])

  useEffect(() => {
    const init = async () => {
      await refreshDashboardList()
      await loadDashboard()
      setLayoutLoaded(true)
    }

    init()
  }, [loadDashboard, refreshDashboardList])

  // Sauvegarder le layout via l'API
  const saveLayout = useCallback(async (newLayout) => {
    setLayout(newLayout)
    setSaving(true)

    try {
      const res = await fetch('/api/v1/dashboard/layout', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: currentDashboard, widgets: newLayout })
      })

      if (!res.ok) throw new Error('Failed to save')
    } catch (e) {
      console.error('Failed to save layout:', e)
      setSnackbar({ open: true, message: t('dashboard.saveError'), severity: 'error' })
    } finally {
      setSaving(false)
    }
  }, [t, currentDashboard])

  // Compute which widgets are hidden by collapsed sections
  const hiddenBySection = useMemo(() => {
    const hidden = new Set()

    // Sort by y position to process in order
    const sorted = [...layout].sort((a, b) => a.y - b.y || a.x - b.x)
    let currentCollapsed = false

    for (const w of sorted) {
      const def = WIDGET_REGISTRY[w.type]

      if (def?.isSection) {
        currentCollapsed = w.settings?.collapsed || false
      } else if (currentCollapsed) {
        hidden.add(w.id)
      }
    }

    
return hidden
  }, [layout])

  // Visible layout (hide widgets in collapsed sections, unless in edit mode)
  const visibleLayout = editMode ? layout : layout.filter(w => !hiddenBySection.has(w.id))

  // Convertir notre layout en format react-grid-layout (registry overrides saved min/max)
  const gridLayout = visibleLayout.map(w => {
    const def = WIDGET_REGISTRY[w.type]

    
return {
      i: w.id,
      x: w.x,
      y: w.y,
      w: w.w,
      h: def?.isSection ? (editMode ? 1 : 0.5) : w.h,
      minW: def?.minSize?.w ?? w.minW ?? 2,
      minH: def?.isSection ? 0.5 : (def?.minSize?.h ?? w.minH ?? 2),
      maxW: def?.maxSize?.w ?? w.maxW ?? 12,
      maxH: def?.maxSize?.h ?? w.maxH ?? 12,
      isDraggable: editMode,
      isResizable: editMode && !def?.isSection, // sections not resizable in height
    }
  })

  // Handler pour les changements de layout (drag/resize)
  const handleLayoutChange = useCallback((newGridLayout) => {
    if (!editMode) return

    // Mettre à jour notre layout avec les nouvelles positions
    const updatedLayout = layout.map(widget => {
      const gridItem = newGridLayout.find(g => g.i === widget.id)

      if (gridItem) {
        return {
          ...widget,
          x: gridItem.x,
          y: gridItem.y,
          w: gridItem.w,
          h: gridItem.h,
        }
      }

      return widget
    })

    saveLayout(updatedLayout)
  }, [editMode, layout, saveLayout])

  // Ajouter un widget
  const handleAddWidget = (type) => {
    const widgetDef = WIDGET_REGISTRY[type]

    if (!widgetDef) return

    // Trouver une position libre (en bas du layout)
    const maxY = Math.max(...layout.map(w => w.y + w.h), 0)

    const newWidget = {
      id: generateId(),
      type,
      x: 0,
      y: maxY,
      w: widgetDef.defaultSize.w,
      h: widgetDef.defaultSize.h,
      minW: widgetDef.minSize.w,
      minH: widgetDef.minSize.h,
      maxW: widgetDef.maxSize?.w || 12,
      maxH: widgetDef.maxSize?.h || 12,
    }

    saveLayout([...layout, newWidget])
    setAddDialogOpen(false)
    setSnackbar({ open: true, message: t('dashboard.widgetAdded'), severity: 'success' })
  }

  // Supprimer un widget
  const handleRemoveWidget = (id) => {
    saveLayout(layout.filter(w => w.id !== id))
    setSnackbar({ open: true, message: t('dashboard.widgetRemoved'), severity: 'info' })
  }

  // Update widget settings
  const handleUpdateSettings = useCallback((id, newSettings) => {
    const updated = layout.map(w => w.id === id ? { ...w, settings: { ...w.settings, ...newSettings } } : w)

    saveLayout(updated)
  }, [layout, saveLayout])



  // Appliquer un layout prédéfini
  const handleApplyPreset = (presetId) => {
    const preset = PRESET_LAYOUTS[presetId]

    if (preset) {
      saveLayout(preset.widgets.map(w => ({ ...w, id: generateId() })))
      setSnackbar({ open: true, message: t('dashboard.layoutApplied', { name: preset.name }), severity: 'success' })
    }

    setLayoutMenuAnchor(null)
  }

  // Reset layout
  const handleResetLayout = async () => {
    try {
      await fetch(`/api/v1/dashboard/layout?name=${encodeURIComponent(currentDashboard)}`, { method: 'DELETE' })
      await refreshDashboardList()
      await loadDashboard()
      setSnackbar({ open: true, message: t('dashboard.layoutReset'), severity: 'success' })
    } catch (e) {
      console.error('Failed to reset layout:', e)
    }

    setLayoutMenuAnchor(null)
  }

  // Multi-dashboard: switch
  const handleSwitchDashboard = async (name) => {
    if (name === currentDashboard) return
    await loadDashboard(name)
  }

  // Multi-dashboard: create
  const handleCreateDashboard = async (name) => {
    if (!name) return
    try {
      // If this is the first dashboard, persist the current "Default" layout first
      if (dashboards.length === 0) {
        await fetch('/api/v1/dashboard/layout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Default', widgets: layout }),
        })
      }

      const res = await fetch('/api/v1/dashboard/layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, widgets: [] }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))

        setSnackbar({ open: true, message: err.error || 'Error', severity: 'error' })

        return
      }

      await refreshDashboardList()
      await loadDashboard(name)
      setSnackbar({ open: true, message: t('dashboard.dashboardCreated', { name }), severity: 'success' })
    } catch {}
  }

  // Multi-dashboard: delete
  const handleDeleteDashboard = async () => {
    const name = dashTabTarget

    if (!name) return
    try {
      await fetch(`/api/v1/dashboard/layout?name=${encodeURIComponent(name)}`, { method: 'DELETE' })
      setDeleteDashDialog(false)
      setDashTabTarget(null)
      await refreshDashboardList()
      await loadDashboard()
      setSnackbar({ open: true, message: t('dashboard.dashboardDeleted', { name }), severity: 'success' })
    } catch {}
  }

  // Multi-dashboard: rename
  const handleRenameDashboard = async (newName) => {
    const oldName = dashTabTarget

    if (!newName || !oldName || newName === oldName) return
    try {
      // Load old, create new with same widgets, delete old
      const res = await fetch(`/api/v1/dashboard/layout?name=${encodeURIComponent(oldName)}`)
      const json = await res.json()
      const widgets = json.data?.widgets || DEFAULT_LAYOUT

      await fetch('/api/v1/dashboard/layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, widgets }),
      })
      await fetch(`/api/v1/dashboard/layout?name=${encodeURIComponent(oldName)}`, { method: 'DELETE' })
      setDashTabTarget(null)
      await refreshDashboardList()
      await loadDashboard(newName)
      setSnackbar({ open: true, message: t('dashboard.dashboardRenamed', { name: newName }), severity: 'success' })
    } catch {}
  }

  // Multi-dashboard: duplicate
  const handleDuplicateDashboard = async () => {
    const srcName = dashTabTarget

    if (!srcName) return
    const dupName = `${srcName} (copy)`

    try {
      const res = await fetch(`/api/v1/dashboard/layout?name=${encodeURIComponent(srcName)}`)
      const json = await res.json()
      const widgets = (json.data?.widgets || DEFAULT_LAYOUT).map(w => ({ ...w, id: generateId() }))

      await fetch('/api/v1/dashboard/layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: dupName, widgets }),
      })
      setDashTabAnchor(null)
      setDashTabTarget(null)
      await refreshDashboardList()
      await loadDashboard(dupName)
      setSnackbar({ open: true, message: t('dashboard.dashboardDuplicated', { name: dupName }), severity: 'success' })
    } catch {}
  }

  const dashboardRef = useRef(null)

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      dashboardRef.current?.requestFullscreen?.().catch(() => {})
      setFullscreen(true)
    } else {
      document.exitFullscreen?.().catch(() => {})
      setFullscreen(false)
    }
  }, [])

  // Listen for fullscreen exit via Escape
  useEffect(() => {
    const handler = () => setFullscreen(!!document.fullscreenElement)

    document.addEventListener('fullscreenchange', handler)
    
return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  const dashList = dashboards.length > 0 ? dashboards : [{ name: 'Default', isActive: true }]

  const handleTabDrop = useCallback((dragName, dropName) => {
    if (!dragName || !dropName || dragName === dropName) return

    setDashboards(prev => {
      const list = prev.length > 0 ? [...prev] : [{ name: 'Default', isActive: true }]
      const fromIdx = list.findIndex(d => d.name === dragName)
      const toIdx = list.findIndex(d => d.name === dropName)

      if (fromIdx < 0 || toIdx < 0) return prev
      const [moved] = list.splice(fromIdx, 1)

      list.splice(toIdx, 0, moved)

      return list
    })
    setDragTabName(null)
    setDragOverName(null)
  }, [])

  if (!layoutLoaded) {
    return (
      <Box sx={{ pt: 2 }}>
        <CardsSkeleton count={6} columns={3} />
      </Box>
    )
  }

  return (
    <Box ref={dashboardRef} sx={{
      height: '100%', display: 'flex', flexDirection: 'column',
      ...(fullscreen && { bgcolor: 'background.default', overflow: 'auto', p: 1 }),
    }}>
      {/* Dashboard tabs */}
      {(() => {
        const TAB_COLORS = ['#6366f1', '#f97316', '#22c55e', '#3b82f6', '#ec4899', '#8b5cf6', '#14b8a6', '#eab308', '#ef4444', '#06b6d4']

        return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '2px', px: 0.5, py: 0.25, flexShrink: 0, borderBottom: '1px solid', borderColor: 'divider' }}>
        {dashList.map((d, idx) => {
          const tabColor = TAB_COLORS[idx % TAB_COLORS.length]

          return (
          <Box
            key={d.name}
            draggable
            onClick={() => handleSwitchDashboard(d.name)}
            onContextMenu={(e) => { e.preventDefault(); setDashTabTarget(d.name); setDashTabAnchor(e.currentTarget) }}
            onDragStart={() => setDragTabName(d.name)}
            onDragEnd={() => { setDragTabName(null); setDragOverName(null) }}
            onDragOver={(e) => { e.preventDefault(); setDragOverName(d.name) }}
            onDrop={(e) => { e.preventDefault(); handleTabDrop(dragTabName, d.name) }}
            sx={{
              px: 1.5, py: 0.5, borderRadius: '6px 6px 0 0', cursor: 'grab',
              fontSize: 11, fontWeight: currentDashboard === d.name ? 700 : 500,
              color: currentDashboard === d.name ? tabColor : 'text.secondary',
              bgcolor: currentDashboard === d.name ? `${tabColor}12` : 'transparent',
              borderBottom: currentDashboard === d.name ? '2px solid' : '2px solid transparent',
              borderColor: currentDashboard === d.name ? tabColor : 'transparent',
              opacity: dragTabName === d.name ? 0.4 : 1,
              borderLeft: dragOverName === d.name && dragTabName !== d.name ? '2px solid' : '2px solid transparent',
              borderLeftColor: dragOverName === d.name && dragTabName !== d.name ? tabColor : 'transparent',
              '&:hover': { bgcolor: 'action.hover' },
              userSelect: 'none', whiteSpace: 'nowrap',
              transition: 'opacity 0.15s, border-left-color 0.15s',
            }}
          >
            {d.name}
          </Box>
          )
        })}
        <Box
          onClick={() => setNewDashDialog(true)}
          sx={{
            px: 1, py: 0.5, cursor: 'pointer',
            fontSize: 13, color: 'text.disabled',
            '&:hover': { color: 'primary.main' },
            userSelect: 'none',
          }}
        >
          +
        </Box>
      </Box>
        )
      })()}

      {/* Dashboard tab context menu */}
      <Menu anchorEl={dashTabAnchor} open={Boolean(dashTabAnchor)} onClose={() => { setDashTabAnchor(null); setDashTabTarget(null) }}>
        <MenuItem dense onClick={() => { setRenameDashDialog(true); setDashTabAnchor(null) }}>
          <ListItemIcon><i className="ri-pencil-line" style={{ fontSize: 16 }} /></ListItemIcon>
          <ListItemText>{t('dashboard.renameDashboard')}</ListItemText>
        </MenuItem>
        <MenuItem dense onClick={() => { handleDuplicateDashboard() }}>
          <ListItemIcon><i className="ri-file-copy-line" style={{ fontSize: 16 }} /></ListItemIcon>
          <ListItemText>{t('dashboard.duplicateDashboard')}</ListItemText>
        </MenuItem>
        {dashList.length > 1 && dashTabTarget !== 'Default' && <Divider />}
        {dashList.length > 1 && dashTabTarget !== 'Default' && (
          <MenuItem dense onClick={() => { setDeleteDashDialog(true); setDashTabAnchor(null) }} sx={{ color: 'error.main' }}>
            <ListItemIcon><i className="ri-delete-bin-line" style={{ fontSize: 16, color: 'inherit' }} /></ListItemIcon>
            <ListItemText>{t('dashboard.deleteDashboard')}</ListItemText>
          </MenuItem>
        )}
      </Menu>

      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'row', minHeight: 0 }}>
      {/* Grid avec react-grid-layout */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          width: '100%',
          position: 'relative',
        }}
      >
      <style>{`
        .react-grid-item {
          container-type: inline-size;
        }
        @container (max-width: 250px) {
          .react-grid-item > div { zoom: 0.8; }
        }
        @container (max-width: 180px) {
          .react-grid-item > div { zoom: 0.65; }
        }
        @container (max-width: 120px) {
          .react-grid-item > div { zoom: 0.5; }
        }
        .react-grid-item.react-grid-placeholder {
          background-color: var(--mui-palette-primary-main);
          opacity: 0.2;
          border-radius: 12px;
        }
        .react-grid-item > .react-resizable-handle {
          display: ${editMode ? 'block' : 'none'};
        }
        @keyframes widgetFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .react-grid-item > div {
          animation: widgetFadeIn 0.4s ease-out both;
        }
        ${visibleLayout.map((_, i) => `.react-grid-item:nth-child(${i + 1}) > div { animation-delay: ${i * 0.06}s; }`).join('\n')}
      `}</style>
        <ResponsiveGridLayout
            className="layout"
            style={{ width: '100%' }}
            width={containerWidth}
            layouts={{ lg: gridLayout }}
            breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
            cols={GRID_COLS}
            rowHeight={ROW_HEIGHT}
            margin={MARGIN}
            isDraggable={editMode}
            isResizable={editMode}
            draggableHandle=".widget-drag-handle"
            onLayoutChange={(currentLayout, allLayouts) => handleLayoutChange(allLayouts.lg || currentLayout)}
            useCSSTransforms={true}
            compactType="vertical"
          >
          {visibleLayout.map((config) => (
            <div key={config.id}>
              <WidgetContainer
                config={config}
                data={data}
                loading={loading}
                editMode={editMode}
                onRemove={() => handleRemoveWidget(config.id)}
                onUpdateSettings={(settings) => handleUpdateSettings(config.id, settings)}
                timeRange={timeRange}
                t={t}
              />
            </div>
          ))}
        </ResponsiveGridLayout>
      </div>

      {/* Toolbar - right side */}
      <Box sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0.25,
        alignItems: 'center',
        pt: 0.5,
        pl: 0.5,
        flexShrink: 0,
      }}>
        {/* Time range picker */}
        <Box sx={{
          display: 'flex', flexDirection: 'column', gap: '2px',
          mb: 0.75, pb: 0.75, borderBottom: '1px solid', borderColor: 'divider',
        }}>
          {TIME_RANGES.map(tr => (
            <Box
              key={tr.value}
              onClick={() => handleTimeRangeChange(tr.value)}
              sx={{
                px: 0.75, py: 0.25, borderRadius: 0.75, cursor: 'pointer',
                fontSize: 10, fontWeight: 700, fontFamily: '"JetBrains Mono", monospace',
                textAlign: 'center', userSelect: 'none', lineHeight: 1.4,
                color: timeRange === tr.value ? 'primary.contrastText' : 'text.secondary',
                bgcolor: timeRange === tr.value ? 'primary.main' : 'transparent',
                '&:hover': {
                  bgcolor: timeRange === tr.value ? 'primary.dark' : 'action.hover',
                },
              }}
            >
              {tr.label}
            </Box>
          ))}
        </Box>
        {saving && (
          <CircularProgress size={14} sx={{ mb: 0.5 }} />
        )}
        {editMode && (
          <>
            <Tooltip title={t('dashboard.addWidget')} placement='left'>
              <IconButton size='small' onClick={() => setAddDialogOpen(true)}>
                <i className='ri-add-line' style={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Add Section" placement='left'>
              <IconButton size='small' onClick={() => handleAddWidget('section-header')}>
                <i className='ri-separator' style={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('dashboard.layouts')} placement='left'>
              <IconButton size='small' onClick={(e) => setLayoutMenuAnchor(e.currentTarget)}>
                <i className='ri-layout-grid-line' style={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          </>
        )}
        <Tooltip title={editMode ? t('dashboard.finish') : t('dashboard.customize')} placement='left'>
          <IconButton
            onClick={() => setEditMode(!editMode)}
            size='small'
            color={editMode ? 'primary' : 'default'}
            sx={editMode ? {
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              '&:hover': { bgcolor: 'primary.dark' }
            } : {}}
          >
            <i className={editMode ? 'ri-check-line' : 'ri-settings-3-line'} style={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
        {onRefresh && (
          <Tooltip title={t('dashboard.refreshData')} placement='left'>
            <IconButton
              onClick={onRefresh}
              disabled={refreshLoading}
              size='small'
            >
              <i className={refreshLoading ? 'ri-loader-4-line' : 'ri-refresh-line'} style={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} placement='left'>
          <IconButton onClick={toggleFullscreen} size='small'>
            <i className={fullscreen ? 'ri-fullscreen-exit-line' : 'ri-fullscreen-line'} style={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Empty state */}
      {layout.length === 0 && (
        <Box sx={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2.5,
          pointerEvents: 'none',
        }}>
          <Box>
            <img
              src={theme.palette.mode === 'dark' ? '/images/proxcenter-logo-dark.svg' : '/images/proxcenter-logo-light.svg'}
              alt=""
              style={{ width: 180, height: 180 }}
            />
          </Box>
          <Typography variant="h5" sx={{ fontWeight: 700, opacity: 0.7 }}>
            {t('dashboard.emptyTitle')}
          </Typography>
          <Typography variant="body2" sx={{ opacity: 0.45, maxWidth: 400, textAlign: 'center', lineHeight: 1.6 }}>
            {t('dashboard.emptyDesc')}
          </Typography>
          <Button
            variant="outlined"
            startIcon={<i className="ri-add-line" />}
            onClick={() => { setEditMode(true); setAddDialogOpen(true) }}
            sx={{ mt: 1, pointerEvents: 'auto' }}
          >
            {t('dashboard.addWidget')}
          </Button>
        </Box>
      )}

      </Box>{/* end flex row */}

      {/* New Dashboard Dialog */}
      {newDashDialog && <NameDialog
        open={newDashDialog}
        title={t('dashboard.newDashboard')}
        label={t('dashboard.dashboardName')}
        submitLabel={t('common.create')}
        onClose={() => setNewDashDialog(false)}
        onSubmit={(name) => { setNewDashDialog(false); handleCreateDashboard(name) }}
        t={t}
      />}

      {/* Rename Dashboard Dialog */}
      {renameDashDialog && <NameDialog
        open={renameDashDialog}
        title={t('dashboard.renameDashboard')}
        label={t('dashboard.dashboardName')}
        submitLabel={t('common.save')}
        initialValue={dashTabTarget || ''}
        onClose={() => setRenameDashDialog(false)}
        onSubmit={(name) => { setRenameDashDialog(false); handleRenameDashboard(name) }}
        t={t}
      />}

      {/* Delete Dashboard Dialog */}
      <Dialog open={deleteDashDialog} onClose={() => setDeleteDashDialog(false)} maxWidth="xs">
        <DialogTitle>{t('dashboard.deleteDashboard')}</DialogTitle>
        <DialogContent>
          <Typography>{t('dashboard.deleteDashboardConfirm', { name: dashTabTarget || '' })}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDashDialog(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" color="error" onClick={handleDeleteDashboard}>{t('common.delete')}</Button>
        </DialogActions>
      </Dialog>

      {/* Add Widget Dialog */}
      <AddWidgetDialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        onAdd={handleAddWidget}
        t={t}
      />

      {/* Layout Menu */}
      <Menu
        anchorEl={layoutMenuAnchor}
        open={Boolean(layoutMenuAnchor)}
        onClose={() => setLayoutMenuAnchor(null)}
      >
        <MenuItem disabled sx={{ opacity: 1 }}>
          <Typography variant='caption' sx={{ fontWeight: 700 }}>{t('dashboard.presetLayouts')}</Typography>
        </MenuItem>
        {Object.values(PRESET_LAYOUTS).map((preset) => (
          <MenuItem key={preset.id} onClick={() => handleApplyPreset(preset.id)}>
            {preset.name}
          </MenuItem>
        ))}
        <MenuItem divider />
        <MenuItem onClick={handleResetLayout} sx={{ color: 'error.main' }}>
          <i className='ri-refresh-line' style={{ marginRight: 8 }} />
          {t('dashboard.reset')}
        </MenuItem>
      </Menu>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert variant='filled' severity={snackbar.severity} onClose={() => setSnackbar({ ...snackbar, open: false })} sx={{ color: '#fff' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}
