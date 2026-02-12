// Configuration de version ProxCenter
export const VERSION = '1.2.0'
export const VERSION_NAME = 'ProxCenter'
export const GITHUB_REPO = 'adminsyspro/proxcenter-ui'
export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`

// Changelog des versions récentes
export const CHANGELOG: Record<string, { date: string; changes: string[] }> = {
  '1.2.0': {
    date: '2026-02-12',
    changes: [
      'Refonte page DRS — KPIs avec graphes recharts, score de santé, panneau d\'activité',
      'Site Recovery complet — réplication, failover, failback, plans de reprise',
      'Emergency DR — démarrage/arrêt VMs DR, failover réel avec isolation réseau',
      'Resource Planner — planification de capacité avec 10+ fonctionnalités',
      'Scanner CVE intégré avec connexion au backend',
      'Mises à jour rolling par nœud avec pré-checks',
      'Mode maintenance HA — détection ha_state Proxmox dans les métriques',
      'Règles d\'affinité par tags Proxmox',
      'Inventaire optimisé — cache SWR, polling 2s, composants modulaires',
      'Bulk actions — démarrage/arrêt/migration groupés depuis le menu contextuel',
      'Console VM/CT améliorée — support proxy nginx et WebSocket direct',
      'Dashboard widgets — Resource Trends, VM Status Waffle',
      'Performance — cache serveur 30s TTL, optimisation 40+ fichiers',
    ]
  },
  '1.1.0': {
    date: '2026-02-07',
    changes: [
      'DRS (Distributed Resource Scheduler) avec migrations live',
      'Règles d\'affinité et anti-affinité',
      'Système de notifications et alertes',
      'Gestion du firewall Proxmox',
      'Système de licences Community/Enterprise',
      'Séparation des fonctionnalités Enterprise avec page guards',
    ]
  },
  '1.0.0': {
    date: '2026-02-06',
    changes: [
      'Version initiale de ProxCenter Community',
      'Gestion multi-cluster Proxmox VE illimitée',
      'Dashboard avec métriques temps réel',
      'Console VM/CT avec noVNC et xterm.js',
      'Support Proxmox Backup Server (PBS)',
      'Monitoring Ceph intégré',
      'Déploiement Docker simplifié',
      'Support multi-langue (FR/EN)',
    ]
  }
}
