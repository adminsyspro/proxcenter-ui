'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { useTranslations } from 'next-intl'
import { ResponsiveGridLayout } from 'react-grid-layout'

import {
  Box, Card, CardContent, CircularProgress, IconButton, Menu, MenuItem,
  Tooltip, Typography, Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Chip, Tabs, Tab, Snackbar, Alert
} from '@mui/material'

import { WIDGET_REGISTRY, WIDGET_CATEGORIES, getWidgetsByCategory } from './widgetRegistry'
import { DEFAULT_LAYOUT, PRESET_LAYOUTS } from './types'

const GRID_COLS = { lg: 12, md: 12, sm: 6, xs: 4, xxs: 2 }
const ROW_HEIGHT = 60
const MARGIN = [12, 12]

// Génère un ID unique
function generateId() {
  return `widget-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

// Composant Widget Container
function WidgetContainer({
  config,
  data,
  loading,
  editMode,
  onRemove,
  t,
}) {
  const widgetDef = WIDGET_REGISTRY[config.type]
  const WidgetComponent = widgetDef?.component

  // Get translated widget name
  const widgetNameKey = config.type.replace(/-([a-z])/g, (m, c) => c.toUpperCase())
  const widgetName = t(`dashboard.widgetNames.${widgetNameKey}`, { defaultValue: widgetDef?.name || config.type })

  if (!WidgetComponent) {
    return (
      <Card variant='outlined' sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography variant='caption' color='error'>{t('dashboard.unknownWidget')} {config.type}</Typography>
      </Card>
    )
  }

  return (
    <Card
      variant='outlined'
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
        transition: 'box-shadow 0.2s',
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
          bgcolor: 'action.hover',
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
          <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CircularProgress size={24} />
          </Box>
        ) : (
          <WidgetComponent config={config} data={data} loading={loading} />
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
  const [layout, setLayout] = useState(DEFAULT_LAYOUT)
  const [editMode, setEditMode] = useState(false)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [layoutMenuAnchor, setLayoutMenuAnchor] = useState(null)
  const [saving, setSaving] = useState(false)
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' })
  const [layoutLoaded, setLayoutLoaded] = useState(false)

  // Mesure de la largeur du conteneur (requis par react-grid-layout v2.x)
  const containerRef = useRef(null)
  const [containerWidth, setContainerWidth] = useState(0)

  useEffect(() => {
    if (!containerRef.current) return

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width)
      }
    })

    resizeObserver.observe(containerRef.current)

    // Mesure initiale
    setContainerWidth(containerRef.current.offsetWidth)

    return () => resizeObserver.disconnect()
  }, [])

  // Charger le layout depuis l'API
  useEffect(() => {
    const loadLayout = async () => {
      try {
        const res = await fetch('/api/v1/dashboard/layout', { cache: 'no-store' })

        if (res.ok) {
          const json = await res.json()

          if (json.data?.widgets && Array.isArray(json.data.widgets)) {
            setLayout(json.data.widgets)
          }
        }
      } catch (e) {
        console.error('Failed to load layout:', e)

        // Fallback sur localStorage si l'API échoue
        const saved = localStorage.getItem('dashboard-layout')

        if (saved) {
          try {
            setLayout(JSON.parse(saved))
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

  // Convertir notre layout en format react-grid-layout
  const gridLayout = layout.map(w => ({
    i: w.id,
    x: w.x,
    y: w.y,
    w: w.w,
    h: w.h,
    minW: w.minW || 2,
    minH: w.minH || 2,
    maxW: w.maxW || 12,
    maxH: w.maxH || 12,
  }))

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

  if (!layoutLoaded) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar */}
      <Box sx={{
        display: 'flex',
        justifyContent: 'flex-end',
        gap: 1,
        mb: 0.5,
        flexWrap: 'wrap',
        alignItems: 'center'
      }}>
        {saving && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mr: 1 }}>
            <CircularProgress size={16} />
            <Typography variant='caption' sx={{ opacity: 0.6 }}>{t('dashboard.saving')}</Typography>
          </Box>
        )}
        {editMode && (
          <>
            <Button
              variant='outlined'
              size='small'
              startIcon={<i className='ri-add-line' />}
              onClick={() => setAddDialogOpen(true)}
            >
              {t('dashboard.add')}
            </Button>
            <Button
              variant='outlined'
              size='small'
              onClick={(e) => setLayoutMenuAnchor(e.currentTarget)}
            >
              {t('dashboard.layouts')}
            </Button>
          </>
        )}
        <Tooltip title={editMode ? t('dashboard.finish') : t('dashboard.customize')}>
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
            <i className={editMode ? 'ri-check-line' : 'ri-settings-3-line'} />
          </IconButton>
        </Tooltip>
        {onRefresh && (
          <Tooltip title={t('dashboard.refreshData')}>
            <IconButton
              onClick={onRefresh}
              disabled={refreshLoading}
              size='small'
            >
              <i className={refreshLoading ? 'ri-loader-4-line' : 'ri-refresh-line'} />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/* Grid avec react-grid-layout */}
      <Box
        ref={containerRef}
        sx={{
          flex: 1,
          '& .react-grid-item.react-grid-placeholder': {
            bgcolor: 'primary.main',
            opacity: 0.2,
            borderRadius: 1,
          },
          '& .react-grid-item > .react-resizable-handle': {
            display: editMode ? 'block' : 'none',
          },
          '& .react-grid-item > .react-resizable-handle::after': {
            borderColor: 'text.disabled',
          },
        }}
      >
        {containerWidth > 0 && (
          <ResponsiveGridLayout
            className="layout"
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
          {layout.map((config) => (
            <div key={config.id}>
              <WidgetContainer
                config={config}
                data={data}
                loading={loading}
                editMode={editMode}
                onRemove={() => handleRemoveWidget(config.id)}
                t={t}
              />
            </div>
          ))}
          </ResponsiveGridLayout>
        )}
      </Box>

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
        <Alert severity={snackbar.severity} onClose={() => setSnackbar({ ...snackbar, open: false })}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}
