// Registre de tous les widgets disponibles

import dynamic from 'next/dynamic'

// Import dynamique pour éviter les problèmes SSR
const KpiClustersWidget = dynamic(() => import('./widgets/KpiClustersWidget'), { ssr: false })
const KpiVmsWidget = dynamic(() => import('./widgets/KpiVmsWidget'), { ssr: false })
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

// Widgets Zero Trust / Security (optimized - minimal HTTP calls)
const ZeroTrustScoreWidget = dynamic(() => import('./widgets/ZeroTrustScoreWidget'), { ssr: false })
const ZeroTrustSecurityGroupsWidget = dynamic(() => import('./widgets/ZeroTrustSecurityGroupsWidget'), { ssr: false })

export const WIDGET_REGISTRY = {
  'kpi-clusters': {
    type: 'kpi-clusters',
    name: 'Clusters / Nodes',
    description: 'Affiche le nombre de clusters et nodes',
    icon: 'ri-server-line',
    category: 'infrastructure',
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 6, h: 3 },
    component: KpiClustersWidget,
  },
  'kpi-vms': {
    type: 'kpi-vms',
    name: 'VMs Running',
    description: 'Affiche le nombre de VMs en cours',
    icon: 'ri-computer-line',
    category: 'infrastructure',
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 6, h: 3 },
    component: KpiVmsWidget,
  },
  'kpi-backups': {
    type: 'kpi-backups',
    name: 'Backups 24h',
    description: 'Affiche les stats de backup PBS',
    icon: 'ri-shield-check-line',
    category: 'backup',
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 6, h: 3 },
    component: KpiBackupsWidget,
  },
  'kpi-alerts': {
    type: 'kpi-alerts',
    name: 'Alertes',
    description: 'Affiche le nombre d\'alertes',
    icon: 'ri-alarm-warning-line',
    category: 'monitoring',
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 6, h: 3 },
    component: KpiAlertsWidget,
  },
  'quick-stats': {
    type: 'quick-stats',
    name: 'Stats Rapides',
    description: 'Vue d\'ensemble en une ligne',
    icon: 'ri-dashboard-line',
    category: 'infrastructure',
    defaultSize: { w: 12, h: 2 },
    minSize: { w: 6, h: 2 },
    maxSize: { w: 12, h: 2 },
    component: QuickStatsWidget,
  },
  'resources-gauges': {
    type: 'resources-gauges',
    name: 'Ressources',
    description: 'Jauges CPU, RAM et Storage',
    icon: 'ri-pie-chart-line',
    category: 'resources',
    defaultSize: { w: 4, h: 4 },
    minSize: { w: 3, h: 3 },
    maxSize: { w: 12, h: 6 },
    component: ResourcesGaugesWidget,
  },
  'top-consumers': {
    type: 'top-consumers',
    name: 'Top Consumers',
    description: 'VMs les plus gourmandes',
    icon: 'ri-bar-chart-line',
    category: 'resources',
    defaultSize: { w: 6, h: 4 },
    minSize: { w: 4, h: 3 },
    maxSize: { w: 12, h: 8 },
    component: TopConsumersWidget,
  },
  'nodes-table': {
    type: 'nodes-table',
    name: 'État des Nodes',
    description: 'Tableau des nodes avec CPU/RAM',
    icon: 'ri-server-line',
    category: 'infrastructure',
    defaultSize: { w: 6, h: 5 },
    minSize: { w: 4, h: 3 },
    maxSize: { w: 12, h: 10 },
    component: NodesTableWidget,
  },
  'uptime-nodes': {
    type: 'uptime-nodes',
    name: 'Uptime Nodes',
    description: 'Temps de fonctionnement des nodes',
    icon: 'ri-time-line',
    category: 'infrastructure',
    defaultSize: { w: 4, h: 4 },
    minSize: { w: 3, h: 3 },
    maxSize: { w: 6, h: 8 },
    component: UptimeNodesWidget,
  },
  'pbs-overview': {
    type: 'pbs-overview',
    name: 'PBS Overview',
    description: 'Vue d\'ensemble Proxmox Backup Server',
    icon: 'ri-shield-check-line',
    category: 'backup',
    defaultSize: { w: 5, h: 4 },
    minSize: { w: 3, h: 3 },
    maxSize: { w: 8, h: 8 },
    component: PbsOverviewWidget,
  },
  'backup-recent': {
    type: 'backup-recent',
    name: 'Backups Récents',
    description: 'Derniers backups et erreurs',
    icon: 'ri-history-line',
    category: 'backup',
    defaultSize: { w: 4, h: 4 },
    minSize: { w: 3, h: 3 },
    maxSize: { w: 6, h: 6 },
    component: BackupRecentWidget,
  },
  'clusters-list': {
    type: 'clusters-list',
    name: 'Clusters',
    description: 'Liste des clusters avec status',
    icon: 'ri-cloud-line',
    category: 'infrastructure',
    defaultSize: { w: 4, h: 3 },
    minSize: { w: 3, h: 2 },
    maxSize: { w: 6, h: 6 },
    component: ClustersListWidget,
  },
  'guests-summary': {
    type: 'guests-summary',
    name: 'Guests',
    description: 'Résumé VMs et LXC',
    icon: 'ri-instance-line',
    category: 'infrastructure',
    defaultSize: { w: 4, h: 3 },
    minSize: { w: 3, h: 2 },
    maxSize: { w: 6, h: 4 },
    component: GuestsSummaryWidget,
  },
  'alerts-list': {
    type: 'alerts-list',
    name: 'Liste Alertes',
    description: 'Liste des alertes actives',
    icon: 'ri-alarm-warning-line',
    category: 'monitoring',
    defaultSize: { w: 5, h: 5 },
    minSize: { w: 3, h: 3 },
    maxSize: { w: 8, h: 10 },
    component: AlertsListWidget,
  },
  'activity-feed': {
    type: 'activity-feed',
    name: 'Activité Récente',
    description: 'Tâches et événements récents',
    icon: 'ri-history-line',
    category: 'monitoring',
    defaultSize: { w: 5, h: 5 },
    minSize: { w: 3, h: 3 },
    maxSize: { w: 8, h: 10 },
    component: ActivityFeedWidget,
  },
  'storage-pools': {
    type: 'storage-pools',
    name: 'Storages',
    description: 'Liste des storages PVE',
    icon: 'ri-hard-drive-2-line',
    category: 'storage',
    defaultSize: { w: 4, h: 5 },
    minSize: { w: 3, h: 3 },
    maxSize: { w: 6, h: 8 },
    component: StoragePoolsWidget,
  },
  'ceph-status': {
    type: 'ceph-status',
    name: 'Ceph Status',
    description: 'État du cluster Ceph',
    icon: 'ri-database-2-line',
    category: 'storage',
    defaultSize: { w: 4, h: 4 },
    minSize: { w: 3, h: 3 },
    maxSize: { w: 6, h: 6 },
    component: CephStatusWidget,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // WIDGETS ZERO TRUST / SECURITY (optimized - 1 HTTP call per cluster max)
  // ═══════════════════════════════════════════════════════════════════════════
  'zerotrust-score': {
    type: 'zerotrust-score',
    name: 'Zero Trust Overview',
    description: 'Score de sécurité par cluster (firewall + policies)',
    icon: 'ri-shield-keyhole-line',
    category: 'security',
    defaultSize: { w: 4, h: 4 },
    minSize: { w: 3, h: 3 },
    maxSize: { w: 6, h: 6 },
    component: ZeroTrustScoreWidget,
  },
  'zerotrust-securitygroups': {
    type: 'zerotrust-securitygroups',
    name: 'Security Groups',
    description: 'Liste des Security Groups par cluster',
    icon: 'ri-shield-line',
    category: 'security',
    defaultSize: { w: 4, h: 4 },
    minSize: { w: 3, h: 3 },
    maxSize: { w: 6, h: 6 },
    component: ZeroTrustSecurityGroupsWidget,
  },
}

export const WIDGET_CATEGORIES = [
  { id: 'infrastructure', name: 'Infrastructure', icon: 'ri-server-line' },
  { id: 'resources', name: 'Ressources', icon: 'ri-pie-chart-line' },
  { id: 'security', name: 'Sécurité / Zero Trust', icon: 'ri-shield-keyhole-line' },
  { id: 'backup', name: 'Sauvegardes', icon: 'ri-shield-check-line' },
  { id: 'storage', name: 'Stockage', icon: 'ri-hard-drive-2-line' },
  { id: 'monitoring', name: 'Monitoring', icon: 'ri-alarm-warning-line' },
]

export function getWidgetsByCategory(category) {
  return Object.values(WIDGET_REGISTRY).filter(w => w.category === category)
}
