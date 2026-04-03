// Registre de tous les widgets disponibles

import dynamic from 'next/dynamic'

// Import dynamique pour éviter les problèmes SSR
const KpiClustersWidget = dynamic(() => import('./widgets/KpiClustersWidget'), { ssr: false })
const KpiVmsWidget = dynamic(() => import('./widgets/KpiVmsWidget'), { ssr: false })
const KpiLxcWidget = dynamic(() => import('./widgets/KpiLxcWidget'), { ssr: false })
const KpiBackupsWidget = dynamic(() => import('./widgets/KpiBackupsWidget'), { ssr: false })
const KpiAlertsWidget = dynamic(() => import('./widgets/KpiAlertsWidget'), { ssr: false })
const ResourcesGaugesWidget = dynamic(() => import('./widgets/ResourcesGaugesWidget'), { ssr: false })
const TopConsumersWidget = dynamic(() => import('./widgets/TopConsumersWidget'), { ssr: false })
const NodesTableWidget = dynamic(() => import('./widgets/NodesTableWidget'), { ssr: false })
const PbsOverviewWidget = dynamic(() => import('./widgets/PbsOverviewWidget'), { ssr: false })
const ClustersListWidget = dynamic(() => import('./widgets/ClustersListWidget'), { ssr: false })
const GuestsSummaryWidget = dynamic(() => import('./widgets/GuestsSummaryWidget'), { ssr: false })
const AlertsListWidget = dynamic(() => import('./widgets/AlertsListWidget'), { ssr: false })
const CephStatusWidget = dynamic(() => import('./widgets/CephStatusWidget'), { ssr: false })

// Nouveaux widgets
const ActivityFeedWidget = dynamic(() => import('./widgets/ActivityFeedWidget'), { ssr: false })
const StoragePoolsWidget = dynamic(() => import('./widgets/StoragePoolsWidget'), { ssr: false })
const UptimeNodesWidget = dynamic(() => import('./widgets/UptimeNodesWidget'), { ssr: false })
const BackupRecentWidget = dynamic(() => import('./widgets/BackupRecentWidget'), { ssr: false })
const QuickStatsWidget = dynamic(() => import('./widgets/QuickStatsWidget'), { ssr: false })



// Infrastructure Global Chart (per-node CPU/RAM)
const InfraGlobalChartWidget = dynamic(() => import('./widgets/InfraGlobalChartWidget'), { ssr: false })

// VM Heatmap (CPU/RAM utilization grid)
const VmHeatmapWidget = dynamic(() => import('./widgets/VmHeatmapWidget'), { ssr: false })

// Backup Calendar
const BackupCalendarWidget = dynamic(() => import('./widgets/BackupCalendarWidget'), { ssr: false })

// Nodes Gauges, Clusters Gauges & Cluster Health
const NodesGaugesWidget = dynamic(() => import('./widgets/NodesGaugesWidget'), { ssr: false })
const ClustersGaugesWidget = dynamic(() => import('./widgets/ClustersGaugesWidget'), { ssr: false })
const ClusterHealthWidget = dynamic(() => import('./widgets/ClusterHealthWidget'), { ssr: false })

// Section Header
const SectionHeaderWidget = dynamic(() => import('./widgets/SectionHeaderWidget'), { ssr: false })

// Enterprise: DRS & Site Recovery
const DrsStatusWidget = dynamic(() => import('./widgets/DrsStatusWidget'), { ssr: false })
const SiteRecoveryWidget = dynamic(() => import('./widgets/SiteRecoveryWidget'), { ssr: false })

export const WIDGET_REGISTRY = {
  'section-header': {
    type: 'section-header',
    name: 'Section',
    description: 'Collapsible section header',
    icon: 'ri-separator',
    category: 'infrastructure',
    defaultSize: { w: 12, h: 1 },
    minSize: { w: 4, h: 1 },
    maxSize: { w: 12, h: 1 },
    noContainer: true,
    isSection: true,
    component: SectionHeaderWidget,
  },
  'kpi-clusters': {
    type: 'kpi-clusters',
    name: 'Clusters / Nodes',
    description: 'Number of clusters and nodes',
    icon: 'ri-server-line',
    category: 'infrastructure',
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 1, h: 1 },
    maxSize: { w: 12, h: 20 },
    noContainer: true,
    component: KpiClustersWidget,
  },
  'kpi-vms': {
    type: 'kpi-vms',
    name: 'VMs Running',
    description: 'Number of running VMs',
    icon: 'ri-computer-line',
    category: 'infrastructure',
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 1, h: 1 },
    maxSize: { w: 12, h: 20 },
    noContainer: true,
    component: KpiVmsWidget,
  },
  'kpi-lxc': {
    type: 'kpi-lxc',
    name: 'LXC Running',
    description: 'Number of running LXC containers',
    icon: 'ri-instance-line',
    category: 'infrastructure',
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 1, h: 1 },
    maxSize: { w: 12, h: 20 },
    noContainer: true,
    component: KpiLxcWidget,
  },
  'kpi-backups': {
    type: 'kpi-backups',
    name: 'Backups 24h',
    description: 'PBS backup stats',
    icon: 'ri-shield-check-line',
    category: 'backup',
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 1, h: 1 },
    maxSize: { w: 12, h: 20 },
    noContainer: true,
    component: KpiBackupsWidget,
  },
  'kpi-alerts': {
    type: 'kpi-alerts',
    name: 'Alerts',
    description: 'Number of alerts',
    icon: 'ri-alarm-warning-line',
    category: 'monitoring',
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 1, h: 1 },
    maxSize: { w: 12, h: 20 },
    noContainer: true,
    component: KpiAlertsWidget,
  },
  'quick-stats': {
    type: 'quick-stats',
    name: 'Quick Stats',
    description: 'Overview in one line',
    icon: 'ri-dashboard-line',
    category: 'infrastructure',
    defaultSize: { w: 12, h: 2 },
    minSize: { w: 6, h: 2 },
    maxSize: { w: 12, h: 20 },
    noContainer: true,
    component: QuickStatsWidget,
  },
  'resources-gauges': {
    type: 'resources-gauges',
    name: 'Resources',
    description: 'CPU, RAM and Storage gauges',
    icon: 'ri-pie-chart-line',
    category: 'resources',
    defaultSize: { w: 4, h: 4 },
    minSize: { w: 3, h: 3 },
    maxSize: { w: 12, h: 20 },
    noContainer: true,
    component: ResourcesGaugesWidget,
  },
  'top-consumers': {
    type: 'top-consumers',
    name: 'Top Consumers',
    description: 'Most resource-intensive guests',
    icon: 'ri-bar-chart-line',
    category: 'resources',
    defaultSize: { w: 6, h: 4 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 12, h: 20 },
    noContainer: true,
    component: TopConsumersWidget,
  },
  'nodes-table': {
    type: 'nodes-table',
    name: 'Nodes Status',
    description: 'Nodes table with CPU/RAM',
    icon: 'ri-server-line',
    category: 'infrastructure',
    defaultSize: { w: 6, h: 5 },
    minSize: { w: 4, h: 3 },
    maxSize: { w: 12, h: 20 },
    noContainer: true,
    component: NodesTableWidget,
  },
  'uptime-nodes': {
    type: 'uptime-nodes',
    name: 'Uptime Nodes',
    description: 'Nodes uptime',
    icon: 'ri-time-line',
    category: 'infrastructure',
    defaultSize: { w: 4, h: 4 },
    minSize: { w: 3, h: 3 },
    maxSize: { w: 12, h: 20 },
    noContainer: true,
    component: UptimeNodesWidget,
  },
  'pbs-overview': {
    type: 'pbs-overview',
    name: 'PBS Overview',
    description: 'Proxmox Backup Server overview',
    icon: 'ri-shield-check-line',
    category: 'backup',
    defaultSize: { w: 3, h: 5 },
    minSize: { w: 2, h: 3 },
    maxSize: { w: 12, h: 20 },
    noContainer: true,
    component: PbsOverviewWidget,
  },
  'backup-calendar': {
    type: 'backup-calendar',
    name: 'Backup Calendar',
    description: 'Backup history over 30 days',
    icon: 'ri-calendar-check-line',
    category: 'backup',
    defaultSize: { w: 6, h: 5 },
    minSize: { w: 3, h: 3 },
    maxSize: { w: 12, h: 20 },
    noContainer: true,
    component: BackupCalendarWidget,
  },
  'backup-recent': {
    type: 'backup-recent',
    name: 'Recent Backups',
    description: 'Recent backups and errors',
    icon: 'ri-history-line',
    category: 'backup',
    defaultSize: { w: 4, h: 4 },
    minSize: { w: 3, h: 3 },
    maxSize: { w: 12, h: 20 },
    noContainer: true,
    component: BackupRecentWidget,
  },
  'clusters-list': {
    type: 'clusters-list',
    name: 'Clusters',
    description: 'Clusters list with status',
    icon: 'ri-cloud-line',
    category: 'infrastructure',
    defaultSize: { w: 4, h: 3 },
    minSize: { w: 3, h: 2 },
    maxSize: { w: 12, h: 20 },
    noContainer: true,
    component: ClustersListWidget,
  },
  'guests-summary': {
    type: 'guests-summary',
    name: 'Guests',
    description: 'VMs and LXC summary',
    icon: 'ri-instance-line',
    category: 'infrastructure',
    defaultSize: { w: 4, h: 3 },
    minSize: { w: 3, h: 2 },
    maxSize: { w: 12, h: 20 },
    noContainer: true,
    component: GuestsSummaryWidget,
  },
  'alerts-list': {
    type: 'alerts-list',
    name: 'Alerts List',
    description: 'Active alerts list',
    icon: 'ri-alarm-warning-line',
    category: 'monitoring',
    defaultSize: { w: 5, h: 5 },
    minSize: { w: 3, h: 3 },
    maxSize: { w: 12, h: 20 },
    noContainer: true,
    component: AlertsListWidget,
  },
  'activity-feed': {
    type: 'activity-feed',
    name: 'Recent Activity',
    description: 'Recent tasks and events',
    icon: 'ri-history-line',
    category: 'monitoring',
    defaultSize: { w: 5, h: 5 },
    minSize: { w: 3, h: 3 },
    maxSize: { w: 12, h: 20 },
    noContainer: true,
    component: ActivityFeedWidget,
  },
  'storage-pools': {
    type: 'storage-pools',
    name: 'Storages',
    description: 'PVE storages list',
    icon: 'ri-hard-drive-2-line',
    category: 'storage',
    defaultSize: { w: 4, h: 5 },
    minSize: { w: 3, h: 3 },
    maxSize: { w: 12, h: 20 },
    noContainer: true,
    component: StoragePoolsWidget,
  },
  'ceph-status': {
    type: 'ceph-status',
    name: 'Ceph Status',
    description: 'Ceph cluster status',
    icon: 'ri-database-2-line',
    category: 'storage',
    defaultSize: { w: 4, h: 4 },
    minSize: { w: 3, h: 3 },
    maxSize: { w: 12, h: 20 },
    noContainer: true,
    component: CephStatusWidget,
  },

  'infra-global-chart': {
    type: 'infra-global-chart',
    name: 'Infra CPU/RAM',
    description: 'Per-node CPU/RAM across all infrastructure',
    icon: 'ri-line-chart-fill',
    category: 'resources',
    defaultSize: { w: 8, h: 6 },
    minSize: { w: 4, h: 4 },
    maxSize: { w: 12, h: 20 },
    noContainer: true,
    component: InfraGlobalChartWidget,
  },
  'vm-heatmap': {
    type: 'vm-heatmap',
    name: 'Guest Map',
    description: 'Status, CPU/RAM heatmap of all guests',
    icon: 'ri-grid-fill',
    category: 'infrastructure',
    defaultSize: { w: 6, h: 5 },
    minSize: { w: 3, h: 3 },
    maxSize: { w: 12, h: 20 },
    noContainer: true,
    component: VmHeatmapWidget,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // NODES GAUGES & CLUSTER HEALTH
  // ═══════════════════════════════════════════════════════════════════════════
  'nodes-gauges': {
    type: 'nodes-gauges',
    name: 'Nodes Gauges',
    description: 'Per-node circular gauges (CPU, RAM, Disk)',
    icon: 'ri-donut-chart-line',
    category: 'infrastructure',
    defaultSize: { w: 8, h: 6 },
    minSize: { w: 3, h: 3 },
    maxSize: { w: 12, h: 20 },
    noContainer: true,
    component: NodesGaugesWidget,
  },
  'clusters-gauges': {
    type: 'clusters-gauges',
    name: 'Clusters Gauges',
    description: 'Per-cluster gauges, sparklines and health score',
    icon: 'ri-donut-chart-line',
    category: 'infrastructure',
    defaultSize: { w: 8, h: 6 },
    minSize: { w: 3, h: 3 },
    maxSize: { w: 12, h: 20 },
    noContainer: true,
    component: ClustersGaugesWidget,
  },
  'cluster-health': {
    type: 'cluster-health',
    name: 'Cluster Health',
    description: 'Health score with key metrics',
    icon: 'ri-heart-pulse-line',
    category: 'infrastructure',
    defaultSize: { w: 4, h: 5 },
    minSize: { w: 3, h: 4 },
    maxSize: { w: 12, h: 20 },
    noContainer: true,
    component: ClusterHealthWidget,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ENTERPRISE: AUTOMATION & ORCHESTRATION
  // ═══════════════════════════════════════════════════════════════════════════
  'drs-status': {
    type: 'drs-status',
    name: 'DRS Status',
    description: 'DRS status, active migrations and recommendations',
    icon: 'ri-swap-line',
    category: 'automation',
    defaultSize: { w: 8, h: 6 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 12, h: 20 },
    noContainer: true,
    component: DrsStatusWidget,
  },
  'site-recovery': {
    type: 'site-recovery',
    name: 'Site Recovery',
    description: 'VM protection, RPO compliance and replication status',
    icon: 'ri-shield-star-line',
    category: 'automation',
    defaultSize: { w: 4, h: 4 },
    minSize: { w: 3, h: 3 },
    maxSize: { w: 12, h: 20 },
    noContainer: true,
    component: SiteRecoveryWidget,
  },
}

export const WIDGET_CATEGORIES = [
  { id: 'infrastructure', name: 'Infrastructure', icon: 'ri-server-line' },
  { id: 'resources', name: 'Resources', icon: 'ri-pie-chart-line' },
  { id: 'backup', name: 'Backups', icon: 'ri-shield-check-line' },
  { id: 'storage', name: 'Storage', icon: 'ri-hard-drive-2-line' },
  { id: 'monitoring', name: 'Monitoring', icon: 'ri-alarm-warning-line' },
  { id: 'automation', name: 'Automation', icon: 'ri-robot-2-line' },
]

export function getWidgetsByCategory(category) {
  return Object.values(WIDGET_REGISTRY).filter(w => w.category === category)
}
