// Configuration de version ProxCenter
export const VERSION = '1.0.0'
export const VERSION_NAME = 'ProxCenter'
export const GITHUB_REPO = 'adminsyspro/proxcenter-ui'
export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`

// Changelog des versions récentes
export const CHANGELOG: Record<string, { date: string; changes: string[] }> = {
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
