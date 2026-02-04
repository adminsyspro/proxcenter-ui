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

// Layout par défaut
export const DEFAULT_LAYOUT: WidgetConfig[] = [
  { id: 'kpi-1', type: 'kpi-clusters', x: 0, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { id: 'kpi-2', type: 'kpi-vms', x: 3, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { id: 'kpi-3', type: 'kpi-backups', x: 6, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { id: 'kpi-4', type: 'kpi-alerts', x: 9, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { id: 'resources-1', type: 'resources-gauges', x: 0, y: 2, w: 6, h: 4, minW: 4, minH: 3 },
  { id: 'top-1', type: 'top-consumers', x: 6, y: 2, w: 6, h: 4, minW: 4, minH: 3 },
  { id: 'nodes-1', type: 'nodes-table', x: 0, y: 6, w: 7, h: 6, minW: 4, minH: 4 },
  { id: 'pbs-1', type: 'pbs-overview', x: 7, y: 6, w: 5, h: 3, minW: 3, minH: 3 },
  { id: 'clusters-1', type: 'clusters-list', x: 7, y: 9, w: 5, h: 3, minW: 3, minH: 2 },
]

// Layouts prédéfinis
export const PRESET_LAYOUTS: Record<string, DashboardLayout> = {
  default: {
    id: 'default',
    name: 'Par défaut',
    widgets: DEFAULT_LAYOUT,
  },
  compact: {
    id: 'compact',
    name: 'Compact',
    widgets: [
      { id: 'kpi-1', type: 'kpi-clusters', x: 0, y: 0, w: 4, h: 2, minW: 2, minH: 2 },
      { id: 'kpi-2', type: 'kpi-vms', x: 4, y: 0, w: 4, h: 2, minW: 2, minH: 2 },
      { id: 'kpi-3', type: 'kpi-alerts', x: 8, y: 0, w: 4, h: 2, minW: 2, minH: 2 },
      { id: 'resources-1', type: 'resources-gauges', x: 0, y: 2, w: 6, h: 4, minW: 3, minH: 3 },
      { id: 'nodes-1', type: 'nodes-table', x: 6, y: 2, w: 6, h: 4, minW: 4, minH: 3 },
    ],
  },
  storage: {
    id: 'storage',
    name: 'Stockage',
    widgets: [
      { id: 'kpi-1', type: 'kpi-clusters', x: 0, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
      { id: 'kpi-3', type: 'kpi-backups', x: 3, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
      { id: 'kpi-4', type: 'kpi-alerts', x: 6, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
      { id: 'resources-1', type: 'resources-gauges', x: 9, y: 0, w: 3, h: 4, minW: 3, minH: 3 },
      { id: 'pbs-1', type: 'pbs-overview', x: 0, y: 2, w: 6, h: 5, minW: 4, minH: 4 },
      { id: 'ceph-1', type: 'ceph-status', x: 6, y: 2, w: 3, h: 5, minW: 3, minH: 3 },
      { id: 'nodes-1', type: 'nodes-table', x: 0, y: 7, w: 12, h: 5, minW: 6, minH: 4 },
    ],
  },
  monitoring: {
    id: 'monitoring',
    name: 'Monitoring',
    widgets: [
      { id: 'kpi-4', type: 'kpi-alerts', x: 0, y: 0, w: 4, h: 2, minW: 2, minH: 2 },
      { id: 'kpi-2', type: 'kpi-vms', x: 4, y: 0, w: 4, h: 2, minW: 2, minH: 2 },
      { id: 'kpi-3', type: 'kpi-backups', x: 8, y: 0, w: 4, h: 2, minW: 2, minH: 2 },
      { id: 'alerts-1', type: 'alerts-list', x: 0, y: 2, w: 6, h: 6, minW: 4, minH: 4 },
      { id: 'top-1', type: 'top-consumers', x: 6, y: 2, w: 6, h: 6, minW: 4, minH: 4 },
      { id: 'activity-1', type: 'activity-feed', x: 0, y: 8, w: 6, h: 4, minW: 4, minH: 3 },
      { id: 'nodes-1', type: 'nodes-table', x: 6, y: 8, w: 6, h: 4, minW: 4, minH: 3 },
    ],
  },
}
