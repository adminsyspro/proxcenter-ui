// Configuration de version ProxCenter
export const VERSION = '1.0.0'
export const VERSION_NAME = 'ProxCenter'
export const GITHUB_REPO = 'adminsyspro/proxcenter'
export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`

// Changelog des versions récentes
export const CHANGELOG: Record<string, { date: string; changes: string[] }> = {
  '1.0.0': {
    date: '2026-02-06',
    changes: [
      'Version initiale de ProxCenter',
      'Gestion multi-cluster Proxmox VE',
      'Support Proxmox Backup Server',
      'Console VM/CT avec noVNC et xterm.js',
      'Authentification LDAP/Active Directory',
      'Système RBAC complet',
      'Dashboard avec métriques temps réel',
      'Migration et clonage de VMs',
    ]
  }
}
