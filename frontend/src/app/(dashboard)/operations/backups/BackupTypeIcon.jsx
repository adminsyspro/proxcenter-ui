// Leading glyph of a backup row: what was backed up, with the product's
// guest vocabulary (QEMU VM, LXC container, PBS host backup).
const ICONS = { vm: 'ri-computer-line', ct: 'ri-instance-line', host: 'ri-server-line' }

export default function BackupTypeIcon({ type }) {
  const icon = ICONS[type] || 'ri-archive-line'

  return <i className={icon} data-testid={`backup-type-icon-${type || 'unknown'}`} style={{ fontSize: 16, opacity: 0.85, flexShrink: 0 }} />
}
