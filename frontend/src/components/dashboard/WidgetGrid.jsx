'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useTranslations } from 'next-intl'
import { ResponsiveGridLayout } from 'react-grid-layout'

import {
  Box, Card, CardContent, CircularProgress, IconButton, Menu, MenuItem,
  Skeleton, Tooltip, Typography, Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Chip, Tabs, Tab, Snackbar, Alert, useTheme
} from '@mui/material'

import { WIDGET_REGISTRY, WIDGET_CATEGORIES, getWidgetsByCategory } from './widgetRegistry'
import { DEFAULT_LAYOUT, PRESET_LAYOUTS } from './types'
import { CardsSkeleton } from '@/components/skeletons'

const GRID_COLS = { lg: 12, md: 12, sm: 6, xs: 4, xxs: 2 }
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

  // Charger le layout depuis l'API
  useEffect(() => {
    const loadLayout = async () => {
      try {
        const res = await fetch('/api/v1/dashboard/layout')

        if (res.ok) {
          const json = await res.json()

          if (json.data?.widgets && Array.isArray(json.data.widgets)) {
            // Filter out widgets whose type no longer exists in the registry
            const cleaned = json.data.widgets.filter(w => WIDGET_REGISTRY[w.type])

            setLayout(cleaned.length > 0 ? cleaned : DEFAULT_LAYOUT.map(w => ({ ...w, id: generateId() })))
          }
        }
      } catch (e) {
        console.error('Failed to load layout:', e)

        // Fallback sur localStorage si l'API échoue
        const saved = localStorage.getItem('dashboard-layout')

        if (saved) {
          try {
            const parsed = JSON.parse(saved)
            const cleaned = parsed.filter(w => WIDGET_REGISTRY[w.type])

            setLayout(cleaned.length > 0 ? cleaned : DEFAULT_LAYOUT.map(w => ({ ...w, id: generateId() })))
          } catch {}
        }
      } finally {
        setLayoutLoaded(true)
      }
    }

    loadLayout()
  }, [])

  // Sauvegarder le layout via l'API
  const saveLayout = useCallback(async (newLayout) => {
    setLayout(newLayout)

    // Sauvegarder aussi en localStorage comme backup
    localStorage.setItem('dashboard-layout', JSON.stringify(newLayout))

    // Sauvegarder en base via l'API
    setSaving(true)

    try {
      const res = await fetch('/api/v1/dashboard/layout', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ widgets: newLayout })
      })

      if (!res.ok) {
        throw new Error('Failed to save')
      }
    } catch (e) {
      console.error('Failed to save layout:', e)
      setSnackbar({ open: true, message: t('dashboard.saveError'), severity: 'error' })
    } finally {
      setSaving(false)
    }
  }, [t])

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
      await fetch('/api/v1/dashboard/layout', { method: 'DELETE' })
      const newLayout = DEFAULT_LAYOUT.map(w => ({ ...w, id: generateId() }))

      setLayout(newLayout)
      localStorage.removeItem('dashboard-layout')
      setSnackbar({ open: true, message: t('dashboard.layoutReset'), severity: 'success' })
    } catch (e) {
      console.error('Failed to reset layout:', e)
    }

    setLayoutMenuAnchor(null)
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

  if (!layoutLoaded) {
    return (
      <Box sx={{ pt: 2 }}>
        <CardsSkeleton count={6} columns={3} />
      </Box>
    )
  }

  return (
    <Box ref={dashboardRef} sx={{
      height: '100%', display: 'flex', flexDirection: 'row',
      ...(fullscreen && { bgcolor: 'background.default', overflow: 'auto', p: 1 }),
    }}>
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
            onLayoutChange={(newLayout) => handleLayoutChange(newLayout)}
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
            sx={{ mt: 1 }}
          >
            {t('dashboard.addWidget')}
          </Button>
        </Box>
      )}

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
        <Alert variant='filled' severity={snackbar.severity} onClose={() => setSnackbar({ ...snackbar, open: false })}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}
