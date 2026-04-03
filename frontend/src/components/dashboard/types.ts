// Types pour le système de widgets du dashboard

export type WidgetSize = 'small' | 'medium' | 'large'

export type WidgetConfig = {
  id: string           // ID unique de l'instance du widget
  type: string         // Type du widget (ex: 'kpi-summary')
  x: number            // Position X dans la grille
  y: number            // Position Y dans la grille
  w: number            // Largeur en colonnes
  h: number            // Hauteur en lignes
  minW?: number        // Largeur minimum
  minH?: number        // Hauteur minimum
  maxW?: number        // Largeur maximum
  maxH?: number        // Hauteur maximum
  static?: boolean     // Widget non déplaçable
  settings?: Record<string, any>  // Paramètres spécifiques au widget
}

export type WidgetDefinition = {
  type: string
  name: string
  description: string
  icon: string
  category: 'infrastructure' | 'resources' | 'backup' | 'storage' | 'monitoring'
  defaultSize: { w: number; h: number }
  minSize: { w: number; h: number }
  maxSize?: { w: number; h: number }
  component: React.ComponentType<WidgetProps>
}

export type WidgetProps = {
  config: WidgetConfig
  data: any
  loading: boolean
  onRemove?: () => void
  onSettings?: () => void
}

export type DashboardLayout = {
  id: string
  name: string
  widgets: WidgetConfig[]
  columns?: number
  rowHeight?: number
}

// Layout par défaut (ROW_HEIGHT=40)
export const DEFAULT_LAYOUT: WidgetConfig[] = [
  // Section: General
  { id: 'sec-1', type: 'section-header', x: 0, y: 0, w: 12, h: 1, settings: { title: 'General' } },
  { id: 'kpi-1', type: 'kpi-clusters', x: 0, y: 1, w: 1, h: 7 },
  { id: 'kpi-2', type: 'kpi-vms', x: 1, y: 4, w: 1, h: 4 },
  { id: 'kpi-3', type: 'kpi-lxc', x: 1, y: 1, w: 1, h: 3 },
  { id: 'kpi-4', type: 'kpi-alerts', x: 11, y: 1, w: 1, h: 7 },
  { id: 'clusters-g', type: 'clusters-gauges', x: 2, y: 1, w: 4, h: 7 },
  { id: 'heatmap-1', type: 'vm-heatmap', x: 6, y: 1, w: 3, h: 7 },
  { id: 'drs-1', type: 'drs-status', x: 9, y: 1, w: 2, h: 7 },

  // Section: Cluster / Ceph
  { id: 'sec-2', type: 'section-header', x: 0, y: 8, w: 12, h: 1, settings: { title: 'Cluster / Ceph' } },
  { id: 'ceph-1', type: 'ceph-status', x: 0, y: 9, w: 3, h: 10 },
  { id: 'infra-1', type: 'infra-global-chart', x: 3, y: 9, w: 6, h: 10 },
  { id: 'storage-1', type: 'storage-pools', x: 9, y: 9, w: 3, h: 10 },
]

// Layouts prédéfinis (ROW_HEIGHT=40)
export const PRESET_LAYOUTS: Record<string, DashboardLayout> = {
  default: {
    id: 'default',
    name: 'Default',
    widgets: DEFAULT_LAYOUT,
  },
  compact: {
    id: 'compact',
    name: 'Compact',
    widgets: [
      { id: 'kpi-1', type: 'kpi-clusters', x: 0, y: 0, w: 3, h: 3 },
      { id: 'kpi-2', type: 'kpi-vms', x: 3, y: 0, w: 3, h: 3 },
      { id: 'kpi-3', type: 'kpi-alerts', x: 6, y: 0, w: 3, h: 3 },
      { id: 'kpi-4', type: 'kpi-backups', x: 9, y: 0, w: 3, h: 3 },
      { id: 'resources-1', type: 'resources-gauges', x: 0, y: 3, w: 6, h: 6 },
      { id: 'nodes-1', type: 'nodes-table', x: 6, y: 3, w: 6, h: 6 },
    ],
  },
  storage: {
    id: 'storage',
    name: 'Storage',
    widgets: [
      { id: 'sec-1', type: 'section-header', x: 0, y: 0, w: 12, h: 1, settings: { title: 'Overview' } },
      { id: 'kpi-1', type: 'kpi-clusters', x: 0, y: 1, w: 3, h: 3 },
      { id: 'kpi-3', type: 'kpi-backups', x: 3, y: 1, w: 3, h: 3 },
      { id: 'resources-1', type: 'resources-gauges', x: 6, y: 1, w: 6, h: 6 },
      { id: 'sec-2', type: 'section-header', x: 0, y: 7, w: 12, h: 1, settings: { title: 'Backup & Storage' } },
      { id: 'pbs-1', type: 'pbs-overview', x: 0, y: 8, w: 6, h: 8 },
      { id: 'ceph-1', type: 'ceph-status', x: 6, y: 8, w: 6, h: 8 },
      { id: 'storage-1', type: 'storage-pools', x: 0, y: 16, w: 6, h: 6 },
      { id: 'calendar-1', type: 'backup-calendar', x: 6, y: 16, w: 6, h: 6 },
    ],
  },
  monitoring: {
    id: 'monitoring',
    name: 'Monitoring',
    widgets: [
      { id: 'sec-1', type: 'section-header', x: 0, y: 0, w: 12, h: 1, settings: { title: 'Alerts & Activity' } },
      { id: 'kpi-4', type: 'kpi-alerts', x: 0, y: 1, w: 3, h: 3 },
      { id: 'kpi-2', type: 'kpi-vms', x: 3, y: 1, w: 3, h: 3 },
      { id: 'kpi-3', type: 'kpi-backups', x: 6, y: 1, w: 3, h: 3 },
      { id: 'kpi-1', type: 'kpi-clusters', x: 9, y: 1, w: 3, h: 3 },
      { id: 'alerts-1', type: 'alerts-list', x: 0, y: 4, w: 6, h: 8 },
      { id: 'activity-1', type: 'activity-feed', x: 6, y: 4, w: 6, h: 8 },
      { id: 'sec-2', type: 'section-header', x: 0, y: 12, w: 12, h: 1, settings: { title: 'Performance' } },
      { id: 'infra-1', type: 'infra-global-chart', x: 0, y: 13, w: 8, h: 8 },
      { id: 'top-1', type: 'top-consumers', x: 8, y: 13, w: 4, h: 8 },
      { id: 'heatmap-1', type: 'vm-heatmap', x: 0, y: 21, w: 12, h: 6 },
    ],
  },
}
